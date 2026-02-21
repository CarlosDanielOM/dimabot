import { StreamSessionSchema } from '../schemas/stream_session.schema.js';
import { StreamViewerSnapshotSchema } from '../schemas/stream_viewer_snapshot.schema.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getTwitchAppHeader } from './header.js';
import { getTwitchHelixUrl } from './links.js';

const DEFAULT_DASHBOARD_DAYS = 30;
const OFFLINE_CHECK_THRESHOLD = 2;
const SNAPSHOT_RETENTION_DAYS = 90;
const RETENTION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastRetentionCleanupAt = 0;

interface TwitchLiveStream {
    id: string;
    user_id: string;
    user_login?: string;
    user_name?: string;
    title?: string;
    game_name?: string;
    viewer_count?: number;
    started_at?: string;
}

export interface DashboardStreamHistoryPoint {
    date: string;
    viewers: number;
    hours: number;
    bits: number;
    donations: number;
    follows: number;
    subs: number;
}

export interface DashboardTrendPoint {
    date: string;
    viewers: number;
    hours: number;
}

export interface DashboardKpis {
    activeViewers: number;
    averageViewers: number;
    monthlyAverageViewers: number;
    averageHoursPerStream: number;
    totalBits: number;
    totalStreams: number;
    totalDonations: number;
    activeFollows: number;
    activeSubs: number;
    monthlyGoalSubs: number;
    subsProgressPct: number;
}

export interface DashboardAnalyticsResult {
    kpis: DashboardKpis;
    trend: DashboardTrendPoint[];
    streamHistory: DashboardStreamHistoryPoint[];
}

interface RecordStreamOnlineInput {
    channelID: string;
    channel: string;
    streamID?: string;
    startedAt?: string | Date;
}

interface RecordStreamOfflineInput {
    channelID: string;
    endedAt?: string | Date;
}

function toDate(value?: string | Date): Date {
    if (!value) {
        return new Date();
    }

    if (value instanceof Date) {
        return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return new Date();
    }

    return parsed;
}

function roundToOneDecimal(value: number): number {
    return Number(value.toFixed(1));
}

function getDurationMinutes(startedAt: Date, endedAt: Date): number {
    const milliseconds = Math.max(0, endedAt.getTime() - startedAt.getTime());
    return roundToOneDecimal(milliseconds / 60000);
}

function toUtcDayKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function toUtcDayISO(dayKey: string): string {
    return `${dayKey}T00:00:00.000Z`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) {
        return [items];
    }

    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function fetchLiveStreamsByChannelIds(channelIDs: string[]): Promise<Map<string, TwitchLiveStream>> {
    const liveByChannelID = new Map<string, TwitchLiveStream>();
    const uniqueChannelIDs = Array.from(new Set(channelIDs.filter((id) => Boolean(id))));

    if (!uniqueChannelIDs.length) {
        return liveByChannelID;
    }

    try {
        const appHeader = await getTwitchAppHeader();

        const batches = chunkArray(uniqueChannelIDs, 100);
        for (const batch of batches) {
            const params = new URLSearchParams({ type: 'live' });
            for (const channelID of batch) {
                params.append('user_id', channelID);
            }

            const response = await fetch(getTwitchHelixUrl('streams', params.toString()), {
                headers: {
                    'Client-Id': appHeader['Client-Id'],
                    'Authorization': appHeader.Authorization,
                    'Content-Type': appHeader['Content-Type']
                }
            });

            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            const streams = Array.isArray(data?.data) ? data.data as TwitchLiveStream[] : [];
            for (const stream of streams) {
                if (!stream.user_id) {
                    continue;
                }
                liveByChannelID.set(stream.user_id, stream);
            }
        }
    } catch (error) {
        console.error('Error in fetchLiveStreamsByChannelIds:', {
            channelIDsCount: uniqueChannelIDs.length,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }

    return liveByChannelID;
}

export async function recordStreamOnlineEvent(input: RecordStreamOnlineInput): Promise<void> {
    const { channelID, channel } = input;

    if (!channelID) {
        return;
    }

    const startedAt = toDate(input.startedAt);
    const streamID = input.streamID || `stream-${channelID}-${startedAt.getTime()}`;

    try {
        const existingLive = await StreamSessionSchema.findOne({
            channelID,
            status: 'live',
            ended_at: null
        }).sort({ started_at: -1 });

        if (existingLive && existingLive.stream_id === streamID) {
            await StreamSessionSchema.updateOne(
                { _id: existingLive._id },
                {
                    $set: {
                        channel,
                        last_seen_live_at: new Date(),
                        consecutive_offline_checks: 0,
                        status: 'live',
                        ended_at: null
                    }
                }
            );
            return;
        }

        if (existingLive && existingLive.stream_id !== streamID) {
            await StreamSessionSchema.updateOne(
                { _id: existingLive._id },
                {
                    $set: {
                        ended_at: startedAt,
                        status: 'orphaned',
                        duration_minutes: getDurationMinutes(existingLive.started_at, startedAt)
                    }
                }
            );
        }

        await StreamSessionSchema.findOneAndUpdate(
            { channelID, stream_id: streamID },
            {
                $setOnInsert: {
                    channelID,
                    stream_id: streamID,
                    started_at: startedAt,
                    peak_viewers: 0,
                    average_viewers: 0,
                    sample_count: 0,
                    sample_total_viewers: 0,
                    duration_minutes: 0,
                    follows: 0,
                    subs: 0,
                    bits: 0,
                    donations: 0
                },
                $set: {
                    channel,
                    status: 'live',
                    ended_at: null,
                    last_seen_live_at: new Date(),
                    consecutive_offline_checks: 0
                }
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('Error in recordStreamOnlineEvent:', {
            channelID,
            streamID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export async function recordStreamOfflineEvent(input: RecordStreamOfflineInput): Promise<void> {
    const { channelID } = input;
    if (!channelID) {
        return;
    }

    const endedAt = toDate(input.endedAt);

    try {
        const activeSession = await StreamSessionSchema.findOne({
            channelID,
            status: 'live',
            ended_at: null
        }).sort({ started_at: -1 });

        if (!activeSession) {
            return;
        }

        await StreamSessionSchema.updateOne(
            { _id: activeSession._id },
            {
                $set: {
                    ended_at: endedAt,
                    status: 'offline',
                    duration_minutes: getDurationMinutes(activeSession.started_at, endedAt),
                    consecutive_offline_checks: 0
                }
            }
        );
    } catch (error) {
        console.error('Error in recordStreamOfflineEvent:', {
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export async function collectLiveViewerSnapshots(): Promise<void> {
    try {
        const now = Date.now();
        if (now - lastRetentionCleanupAt >= RETENTION_CLEANUP_INTERVAL_MS) {
            const retentionCutoff = new Date(now - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
            await StreamViewerSnapshotSchema.deleteMany({ captured_at: { $lt: retentionCutoff } });
            lastRetentionCleanupAt = now;
        }

        const activeSessions = await StreamSessionSchema.find({
            status: 'live',
            ended_at: null
        }).select('_id channelID stream_id started_at sample_count sample_total_viewers peak_viewers').lean();

        if (!activeSessions.length) {
            return;
        }

        const liveByChannelID = await fetchLiveStreamsByChannelIds(activeSessions.map((session) => session.channelID));

        for (const session of activeSessions) {
            const liveStream = liveByChannelID.get(session.channelID) || null;

            if (liveStream) {
                const capturedAt = new Date();
                const viewers = Math.max(0, Number(liveStream.viewer_count ?? 0));

                await new StreamViewerSnapshotSchema({
                    channelID: session.channelID,
                    session_id: session._id,
                    stream_id: liveStream.id || session.stream_id,
                    captured_at: capturedAt,
                    viewers,
                    title: liveStream.title || '',
                    game_name: liveStream.game_name || ''
                }).save();

                const nextSampleCount = Number(session.sample_count || 0) + 1;
                const nextSampleTotal = Number(session.sample_total_viewers || 0) + viewers;
                const peakViewers = Math.max(Number(session.peak_viewers || 0), viewers);

                await StreamSessionSchema.updateOne(
                    { _id: session._id },
                    {
                        $set: {
                            stream_id: liveStream.id || session.stream_id,
                            sample_count: nextSampleCount,
                            sample_total_viewers: nextSampleTotal,
                            average_viewers: Math.round(nextSampleTotal / nextSampleCount),
                            peak_viewers: peakViewers,
                            last_seen_live_at: capturedAt,
                            consecutive_offline_checks: 0
                        }
                    }
                );

                continue;
            }

            const updatedSession = await StreamSessionSchema.findOneAndUpdate(
                { _id: session._id },
                { $inc: { consecutive_offline_checks: 1 } },
                { new: true }
            );

            if (updatedSession && updatedSession.consecutive_offline_checks >= OFFLINE_CHECK_THRESHOLD) {
                const now = new Date();
                await StreamSessionSchema.updateOne(
                    { _id: updatedSession._id },
                    {
                        $set: {
                            ended_at: now,
                            status: 'orphaned',
                            duration_minutes: getDurationMinutes(updatedSession.started_at, now)
                        }
                    }
                );
            }
        }
    } catch (error) {
        console.error('Error in collectLiveViewerSnapshots:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export async function reconcileLiveSessionsOnStartup(): Promise<void> {
    try {
        const streamerIDs = await TwitchStreamers.getTwitchStreamers();
        if (!streamerIDs.length) {
            return;
        }

        const liveByChannelID = await fetchLiveStreamsByChannelIds(streamerIDs);
        if (!liveByChannelID.size) {
            return;
        }

        for (const [channelID, stream] of liveByChannelID) {
            await recordStreamOnlineEvent({
                channelID,
                channel: stream.user_login || stream.user_name || '',
                streamID: stream.id,
                startedAt: stream.started_at
            });
        }

        await collectLiveViewerSnapshots();
    } catch (error) {
        console.error('Error in reconcileLiveSessionsOnStartup:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export function startStreamAnalyticsWorker(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
    const run = async () => {
        await collectLiveViewerSnapshots();
    };

    run().catch((error) => {
        console.error('Error in startStreamAnalyticsWorker initial run:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    });

    return setInterval(() => {
        run().catch((error) => {
            console.error('Error in stream analytics worker tick:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });
        });
    }, intervalMs);
}

export async function getDashboardAnalytics(channelID: string, days = DEFAULT_DASHBOARD_DAYS): Promise<DashboardAnalyticsResult> {
    const now = new Date();
    const since = new Date(now);
    since.setUTCDate(now.getUTCDate() - (Math.max(days, 1) - 1));
    since.setUTCHours(0, 0, 0, 0);

    const sessions = await StreamSessionSchema.find({
        channelID,
        started_at: { $gte: since }
    }).sort({ started_at: 1 }).lean();

    const streamHistory: DashboardStreamHistoryPoint[] = sessions.map((session) => {
        const endedAt = session.ended_at ? new Date(session.ended_at) : now;
        const durationMinutes = session.duration_minutes > 0
            ? session.duration_minutes
            : getDurationMinutes(new Date(session.started_at), endedAt);

        return {
            date: new Date(session.started_at).toISOString(),
            viewers: Math.round(session.average_viewers || 0),
            hours: roundToOneDecimal(durationMinutes / 60),
            bits: Math.round(session.bits || 0),
            donations: Number((session.donations || 0).toFixed(2)),
            follows: Math.round(session.follows || 0),
            subs: Math.round(session.subs || 0)
        };
    });

    const trendByDay = new Map<string, { viewersTotal: number; viewersCount: number; hoursTotal: number }>();
    for (const point of streamHistory) {
        const dayKey = toUtcDayKey(new Date(point.date));
        const existing = trendByDay.get(dayKey) || { viewersTotal: 0, viewersCount: 0, hoursTotal: 0 };
        existing.viewersTotal += point.viewers;
        existing.viewersCount += 1;
        existing.hoursTotal += point.hours;
        trendByDay.set(dayKey, existing);
    }

    const trend = Array.from(trendByDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dayKey, totals]) => ({
            date: toUtcDayISO(dayKey),
            viewers: totals.viewersCount > 0 ? Math.round(totals.viewersTotal / totals.viewersCount) : 0,
            hours: roundToOneDecimal(totals.hoursTotal)
        }));

    const totals = streamHistory.reduce((acc, point) => {
        acc.viewers += point.viewers;
        acc.hours += point.hours;
        acc.bits += point.bits;
        acc.donations += point.donations;
        acc.follows += point.follows;
        acc.subs += point.subs;
        return acc;
    }, {
        viewers: 0,
        hours: 0,
        bits: 0,
        donations: 0,
        follows: 0,
        subs: 0
    });

    const latestSnapshot = await StreamViewerSnapshotSchema.findOne({ channelID })
        .sort({ captured_at: -1 })
        .select('viewers')
        .lean();

    const totalStreams = streamHistory.length;
    const averageViewers = totalStreams > 0 ? Math.round(totals.viewers / totalStreams) : 0;
    const averageHoursPerStream = totalStreams > 0 ? roundToOneDecimal(totals.hours / totalStreams) : 0;
    const monthlyGoalSubs = 1000;

    return {
        kpis: {
            activeViewers: Math.round(Number(latestSnapshot?.viewers || 0)),
            averageViewers,
            monthlyAverageViewers: averageViewers,
            averageHoursPerStream,
            totalBits: Math.round(totals.bits),
            totalStreams,
            totalDonations: Number(totals.donations.toFixed(2)),
            activeFollows: Math.round(totals.follows),
            activeSubs: Math.round(totals.subs),
            monthlyGoalSubs,
            subsProgressPct: Math.min(100, Math.round((totals.subs / Math.max(monthlyGoalSubs, 1)) * 100))
        },
        trend,
        streamHistory
    };
}

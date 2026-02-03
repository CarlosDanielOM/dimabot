export interface IBadge {
    set_id: string;
    id: string;
    info: string;
}

export interface FormatBadgesOptions {
    badges: IBadge[];
}

export interface FormatBadgesResponse {
    formattedBadges: string;
    badgeList: string[];
    isMod: boolean;
    isSub: boolean;
    subMonths: number;
}

export async function formatBadges(options: FormatBadgesOptions): Promise<FormatBadgesResponse> {
    const { badges } = options;

    if (!badges || badges.length === 0) {
        return {
            formattedBadges: '',
            badgeList: [],
            isMod: false,
            isSub: false,
            subMonths: 0
        };
    }

    const findBadge = (setId: string): IBadge | undefined => {
        return badges.find(b => b.set_id === setId);
    };

    const labels: string[] = [];
    let isMod = false;
    let isSub = false;
    let subMonths = 0;

    const broadcasterBadge = findBadge('broadcaster');
    const moderatorBadge = findBadge('moderator');
    const vipBadge = findBadge('vip');

    if (broadcasterBadge) {
        labels.push('[STREAMER]');
        isMod = true;
    } else if (moderatorBadge) {
        labels.push('[MOD]');
        isMod = true;
    } else if (vipBadge) {
        labels.push('[VIP]');
    }

    const founderBadge = findBadge('founder');
    const subscriberBadge = findBadge('subscriber');

    if (founderBadge) {
        subMonths = parseInt(founderBadge.info) || 0;
        labels.push(`[FOUNDER ${subMonths}M]`);
        isSub = true;
    } else if (subscriberBadge) {
        subMonths = parseInt(subscriberBadge.info) || 0;
        labels.push(`[SUB ${subMonths}M]`);
        isSub = true;
    }

    if (findBadge('premium')) labels.push('[PRIME]');
    if (findBadge('partner')) labels.push('[PARTNER]');
    if (findBadge('staff')) labels.push('[STAFF]');
    if (findBadge('turbo')) labels.push('[TURBO]');
    if (findBadge('sub-gifter')) labels.push('[SUB-GIFTER]');

    const formattedBadges = labels.length > 0 ? labels.join(' ') + ' ' : '';

    return {
        formattedBadges,
        badgeList: labels,
        isMod,
        isSub,
        subMonths
    };
}

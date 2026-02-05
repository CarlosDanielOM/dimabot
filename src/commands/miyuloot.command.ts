import { ban } from '../functions/moderation/index.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

const days = 24 * 60 * 60 * 1000;

interface MiyulootResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

function weightedRandom(array: string[], weights: number[]): string {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) {
            return array[i];
        }
    }
    return array[0];
}

export async function miyulootCommand(channelID: string, tags: { username: string; 'display-name': string; 'user-id': string }): Promise<MiyulootResponse> {
    try {
        const cache = await getDragonflyClient('miyulootCommand');

        const prizes = [
            'Insulto',
            'besito',
            'VIP',
            '1 Cofre',
            'IRL rana',
            'Timeout 15m',
            '10 Cofres',
            'Miyu Arriesgada'
        ];

        const weights = [
            0.66,
            0.21,
            0.024,
            0.005,
            0.0005,
            0.10,
            0.0000005,
            0.0001
        ];

        const insultos = [
            'Jaja que pendejo, no gano nada el baboso',
            'Jaja, mejor suerte la proxima, pendejo',
            'Tu suerte es tan mala que ni la botarga de rana te quiere.',
            'Con esa suerte que tienes, compras la loteria y terminas perdiendo hasta tu casa',
            'Alguien intento ganar algo hoy y gano pura verga :)',
            'Felicidades, acabas de ganar pura verga',
            'Denle aplausos al pendejo que gano puro aire, a ver si con eso comes',
            'Y tu premio es valer verga, no te preocupes, es pura verga',
        ];

        const prize = weightedRandom(prizes, weights);

        let message = null;

        switch (prize) {
            case 'Insulto':
                message = insultos[Math.floor(Math.random() * insultos.length)];
                break;
            case 'besito':
                message = `${tags['display-name']} ganó el besito!`;
                break;
            case 'VIP':
                message = `${tags['display-name']} ganó el VIP por un stream!`;
                // VIP add logic commented out - add_vip command handles this
                break;
            case '1 Cofre':
                message = `${tags['display-name']} ganó 1 Cofre de StreamLoots!`;
                break;
            case 'IRL rana':
                message = `${tags['display-name']} ganó IRL rana asi que Miyu no sea floja y pongasela!`;
                break;
            case 'Timeout 15m':
                message = `${tags['display-name']} ganó Timeout 15m, alli nos vemos!`;
                await ban(channelID, tags['user-id'], '698614112', 15 * 60, 'Miyu Loot');
                break;
            case '10 Cofres':
                message = `${tags['display-name']} ganó 10 Cofres de StreamLoots!`;
                break;
            case 'Miyu  Arriesgada':
                message = `Miyu ${tags['display-name']} ganó la miyu arriesgada!`;
                break;
            default:
                message = `${tags['display-name']} ganó ${prize}`;
        }

        return {
            error: false,
            message: message || 'Unknown prize',
            status: 200,
            type: 'Miyu'
        };
    } catch (error) {
        console.error(`Error in miyulootCommand:`, {
            channelID,
            tags,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}

export async function notifyDevelopers(message: string, severity: 'error' | 'warning' | 'info') {
    // Placeholder for Discord webhook notifications
    // TODO: Configure Discord webhook URL in .env
    console.error(`[DEV NOTIFICATION - ${severity.toUpperCase()}]: ${message}`);
}

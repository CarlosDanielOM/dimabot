export interface ITwitchAccountCache {
    id: string;
    name: string;
    email: string;
    refresh_token: string;
    access_token: string;
    polar_sh_customer_id: string;
    actived: 'true' | 'false';
    chat_enabled: 'true' | 'false';
    has_permissions: 'true' | 'false';
    up_to_date_permissions: 'true' | 'false';
}
const isProduction = () => process.env.ENVIRONMENT === 'production';
const isTest = () => process.env.ENVIRONMENT === 'test';
const isDev = () => process.env.ENVIRONMENT === 'dev';

export const getEnvironment = () => process.env.ENVIRONMENT || 'dev';

export const getUrl = () => {
    if (isProduction()) {
        return 'https://api.domdimabot.com';
    }
    return 'http://localhost:3000';
};

export const getApiUrl = () => {
    return 'https://api.domdimabot.com';
};

export { isProduction, isTest, isDev };

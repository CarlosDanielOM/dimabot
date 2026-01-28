import dotenv from 'dotenv';
dotenv.config();

async function getAppToken() {

    let params = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'client_credentials',
    });
    
    let result = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    let data = await result.json();

    console.log({data});

    if(data.error) {
        console.error(`Error getting app token: ${data.message}`);
        return null;
    }
}

getAppToken();
const { getClient } = require("../util/database/dragonfly");
const COMMAND = require("../class/command");
const commandSchema = require("../schema/command");

async function sumimetro(channelID, user, touser, commandName) {
    // if(touser === 'reset') {
    //     return await resetSumimetro(channelID);
    // }

    let cmdMessage = null;
    
    let sumimetroCommand = await commandSchema.findOne({channelID, cmd: commandName});

    if(!sumimetroCommand) {
        sumimetroCommand = await commandSchema.findOne({channelID, func: 'sumimetro', message: { $ne: '' } });
    }

    if(!sumimetroCommand) {
        sumimetroCommand = await commandSchema.findOne({channelID, func: 'sumimetro'});
    }

    if(sumimetroCommand && sumimetroCommand.message) {
        cmdMessage = sumimetroCommand.message;
    }

    const cacheClient = getClient();
    let random = Math.floor(Math.random() * 101);

    if(random > 100) {
        random = 100;
    }

    let dominant = random;
    let submissive = 100 - random;

    const lowerCaseUser = user.toLowerCase();
    const lowerCaseToUser = touser.toLowerCase();

    if(lowerCaseUser !== lowerCaseToUser) {
        let targetDominantValue = await cacheClient.get(`${channelID}:sumimetro:${lowerCaseToUser}`);
        if(targetDominantValue) {
            let message = cmdMessage || `El usuario {user} el dia de hoy salio: {sumiso}% sumiso y {dominante}% dominante`;
            let parsedMessage = parseMessage(message, 100 - targetDominantValue, targetDominantValue, touser);
            return {
                error: false,
                message: parsedMessage,
                status: 200,
                type: 'success'
            }
        } else {
            return {
                error: false,
                message: `El usuario ${touser} todavia no se ha dado su lectura del sumimetro`,
                status: 200,
                type: 'success'
            }
        }
    }

    let dominantValue = await cacheClient.get(`${channelID}:sumimetro:${lowerCaseUser}`);
    if(dominantValue) {
        let message = cmdMessage || `El usuario {user} el dia de hoy salio: {sumiso}% sumiso y {dominante}% dominante`;
        let parsedMessage = parseMessage(message, 100 - dominantValue, dominantValue, user);
        return {
            error: false,
            message: parsedMessage,
            status: 200,
            type: 'success'
        }
    }

    await cacheClient.set(`${channelID}:sumimetro:${lowerCaseUser}`, dominant, 'EX', 72000);


    if(dominant > 50) {
        let supremeDominant = await cacheClient.hget(`${channelID}:sumimetro:dominant`, 'value');
        if(!supremeDominant) {
            await cacheClient.hset(`${channelID}:sumimetro:dominant`, 'user', user);
            await cacheClient.hset(`${channelID}:sumimetro:dominant`, 'value', dominant);
            supremeDominant = dominant;

            let response = await fetch(`https://api.domdimabot.com/sumimetro/dominante/${channelID}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({username: user, value: supremeDominant})
            });
        } else {
            if(dominant > supremeDominant) {
                await cacheClient.hset(`${channelID}:sumimetro:dominant`, 'user', user);
                await cacheClient.hset(`${channelID}:sumimetro:dominant`, 'value', dominant);
                supremeDominant = dominant;
    
                let response = await fetch(`https://api.domdimabot.com/sumimetro/dominante/${channelID}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({username: user, value: supremeDominant})
                })
            }
        }

        
        
    } else {
        let supremeSubmissive = await cacheClient.hget(`${channelID}:sumimetro:submissive`, 'value');
        if(!supremeSubmissive) {
            await cacheClient.hset(`${channelID}:sumimetro:submissive`, 'user', user);
            await cacheClient.hset(`${channelID}:sumimetro:submissive`, 'value', submissive);
            supremeSubmissive = submissive;

            let response = await fetch(`https://api.domdimabot.com/sumimetro/sumiso/${channelID}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({username: user, value: supremeSubmissive})
            });
            
        }else {
            if(submissive > supremeSubmissive) {
                await cacheClient.hset(`${channelID}:sumimetro:submissive`, 'user', user);
                await cacheClient.hset(`${channelID}:sumimetro:submissive`, 'value', submissive);
                supremeSubmissive = submissive;

                let response = await fetch(`https://api.domdimabot.com/sumimetro/sumiso/${channelID}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({username: user, value: supremeSubmissive})
                });
            }
        }
    }

    let message = cmdMessage || `Los lectores del sumimetro reflejan que {user} tiene {sumiso}% de sumiso y {dominante}% de dominante`;
    let parsedMessage = parseMessage(message, submissive, dominant, user);

    return {
        error: false,
        message: parsedMessage,
        status: 200,
        type: 'success'
    }
    
}

module.exports = sumimetro;

async function resetSumimetro(channelID) {
    const cacheClient = getClient();
    await cacheClient.del(`${channelID}:sumimetro:dominant`);
    await cacheClient.del(`${channelID}:sumimetro:submissive`);

    await cacheClient.keys(`${channelID}:sumimetro:*`).then(async keys => {
        for(let key of keys) {
            await cacheClient.del(key);
        }
    });
    
    return {
        error: false,
        message: 'Sumimetro has been reset',
        status: 200,
        type: 'success'
    }
}

function parseMessage(message, sumisoValue, dominantValue, user) {
    if(!message) {
        return `Los lectores del sumimetro reflejan que ${user} tiene ${sumisoValue}% de sumiso y ${dominantValue}% de dominante`;
    }

    return message.replaceAll('{sumiso}', sumisoValue).replaceAll('{dominante}', dominantValue).replaceAll('{user}', user);
}
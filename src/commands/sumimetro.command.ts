import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import Commands from "../classes/command.class.js";

export const sumimetroCommand = async (channelID: string, user: string, touser: string, commandName: string): Promise<any> => {
    const cache = await getDragonflyClient();
    let commandMessage = null;

    let sumimetroCommand = await Commands.getCommandFromDB(channelID, commandName);
    if(sumimetroCommand.error || !sumimetroCommand.command) {
        sumimetroCommand = await Commands.getCommandFromDB(channelID, 'sumimetro');
    }

    if(!sumimetroCommand.error && sumimetroCommand.command && sumimetroCommand.command.message) {
        commandMessage = sumimetroCommand.command.message;
    }

    const dominantValue = Math.floor(Math.random() * 101);
    const submissiveValue = 100 - dominantValue;

    const lowerCaseUser = user.toLowerCase();
    const lowerCaseToUser = touser.toLowerCase();

    console.log({channelID, user, touser, commandName, lowerCaseUser, lowerCaseToUser});

    if(touser && lowerCaseUser !== lowerCaseToUser) {
        let targetDominantValue = await cache.get(`${channelID}:sumimetro:${lowerCaseToUser}`);
        if(targetDominantValue) {
            let message = commandMessage || `El usuario {user} el dia de hoy salio: {sumiso}% sumiso y {dominante}% dominante`;
            let parsedMessage = parseMessage(message, 100 - Number(targetDominantValue), Number(targetDominantValue), touser);
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

    let userDominantValue = await cache.get(`${channelID}:sumimetro:${lowerCaseUser}`);
    if(userDominantValue) {
        let message = commandMessage || `El usuario {user} el dia de hoy salio: {sumiso}% sumiso y {dominante}% dominante`;
        let parsedMessage = parseMessage(message, 100 - Number(userDominantValue), Number(userDominantValue), user);
        return {
            error: false,
            message: parsedMessage,
            status: 200,
            type: 'success'
        }
    }

    await cache.set(`${channelID}:sumimetro:${lowerCaseUser}`, dominantValue, {'EX': 72000});


    if(dominantValue > 50) {
        let supremeDominant = await cache.hGet(`${channelID}:sumimetro:dominant`, 'value');
        if(!supremeDominant) {
            await cache.hSet(`${channelID}:sumimetro:dominant`, 'user', user);
            await cache.hSet(`${channelID}:sumimetro:dominant`, 'value', dominantValue);
            supremeDominant = String(dominantValue);

            let response = await fetch(`https://api.domdimabot.com/sumimetro/dominante/${channelID}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({username: user, value: supremeDominant})
            });
        } else {
            if(dominantValue > Number(supremeDominant)) {
                await cache.hSet(`${channelID}:sumimetro:dominant`, 'user', user);
                await cache.hSet(`${channelID}:sumimetro:dominant`, 'value', dominantValue);
                supremeDominant = String(dominantValue);
    
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
        let supremeSubmissive = await cache.hGet(`${channelID}:sumimetro:submissive`, 'value');
        if(!supremeSubmissive) {
            await cache.hSet(`${channelID}:sumimetro:submissive`, 'user', user);
            await cache.hSet(`${channelID}:sumimetro:submissive`, 'value', submissiveValue);
            supremeSubmissive = String(submissiveValue);

            let response = await fetch(`https://api.domdimabot.com/sumimetro/sumiso/${channelID}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({username: user, value: supremeSubmissive})
            });
            
        }else {
            if(submissiveValue > Number(supremeSubmissive)) {
                await cache.hSet(`${channelID}:sumimetro:submissive`, 'user', user);
                await cache.hSet(`${channelID}:sumimetro:submissive`, 'value', submissiveValue);
                supremeSubmissive = String(submissiveValue);

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

    let message = commandMessage || `Los lectores del sumimetro reflejan que {user} tiene {sumiso}% de sumiso y {dominante}% de dominante`;
    let parsedMessage = parseMessage(message, Number(submissiveValue), Number(dominantValue), user);

    return {
        error: false,
        message: parsedMessage,
        status: 200,
        type: 'success'
    }
}

function parseMessage(message: string | null, summissiveValue: number, dominantValue: number, user: string): string {
    if(!message) {
        return `Los lectores del sumimetro reflejan que ${user} tiene ${summissiveValue}% de sumiso y ${dominantValue}% de dominante`;
    }

    return message.replaceAll('{sumiso}', String(summissiveValue)).replaceAll('{dominante}', String(dominantValue)).replaceAll('{user}', user) as string;
}
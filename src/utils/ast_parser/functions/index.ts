import { registerUserFunctions } from './user.functions.js';
import { registerRandomFunctions } from './random.functions.js';
import { registerModerationFunctions } from './moderation.functions.js';
import { registerTwitchFunctions } from './twitch.functions.js';
import { registerCountFunctions } from './count.functions.js';
import { registerChannelFunctions } from './channel.functions.js';
import { registerClipFunctions } from './clip.functions.js';
import { registerFollowageFunctions } from './followage.functions.js';
import { registerEventsubFunctions } from './eventsub.functions.js';
import { registerTtsFunctions } from './tts.functions.js';
import { registerTriggerFunctions } from './trigger.functions.js';

let registered = false;

export function registerAllFunctions(): void {
    if (registered) return;
    registered = true;
    
    registerUserFunctions();
    registerRandomFunctions();
    registerModerationFunctions();
    registerTwitchFunctions();
    registerCountFunctions();
    registerChannelFunctions();
    registerClipFunctions();
    registerFollowageFunctions();
    registerEventsubFunctions();
    registerTtsFunctions();
    registerTriggerFunctions();
}

export { registerFunction, getFunctionHandler, type FunctionHandler } from '../evaluator.js';

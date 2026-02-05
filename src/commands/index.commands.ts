import { sumimetroCommand } from "./sumimetro.command.js";
import { amorCommand } from "./amor.command.js";
import { disableCommandCommand } from "./disable_command.command.js";
import { enableCommandCommand } from "./enable_command.command.js";
import { commandListCommand } from "./command_list.command.js";
import { followageCommand } from "./followage.command.js";
import { titleCommand } from "./title.command.js";
import { gameCommand } from "./game.command.js";
import { addModeratorCommand } from "./add_moderator.command.js";
import { removeModeratorCommand } from "./remove_moderator.command.js";
import { createClipCommand } from "./create_clip.command.js";
import { onlyEmotesCommand } from "./only_emotes.command.js";
import { speechCommand } from "./speech.command.js";
import { promoCommand } from "./promo.command.js";
import { vanishCommand } from "./vanish.command.js";
import { duelCommand } from "./duel.command.js";
import { ruletarusaCommand } from "./ruletarusa.command.js";
import { miyulootCommand } from "./miyuloot.command.js";
import { addVipCommand } from "./add_vip.command.js";
import { pollCommand } from "./poll.command.js";
import { predictionCommand } from "./prediction.command.js";

export const indexCommands = {
    sumimetro: sumimetroCommand,
    amor: amorCommand,
    disableCommand: disableCommandCommand,
    enableCommand: enableCommandCommand,
    commandList: commandListCommand,
    followage: followageCommand,
    title: titleCommand,
    game: gameCommand,
    addModerator: addModeratorCommand,
    removeModerator: removeModeratorCommand,
    createClip: createClipCommand,
    onlyEmotes: onlyEmotesCommand,
    speech: speechCommand,
    promo: promoCommand,
    vanish: vanishCommand,
    duel: duelCommand,
    ruletarusa: ruletarusaCommand,
    miyuloot: miyulootCommand,
    addVip: addVipCommand,
    poll: pollCommand,
    prediction: predictionCommand
}
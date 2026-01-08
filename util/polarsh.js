require('dotenv').config();
const POLARSH = require('@polar-sh/sdk')

let polarshClient = null;

function getPolarShClient() {
    if(polarshClient) return polarshClient;

    if(!process.env.POLARSH_OAT) throw new Error('POLARSH_OAT is not set');

    polarshClient = new POLARSH.Polar({
        accessToken: process.env.POLARSH_OAT
    });

    return polarshClient;
}

module.exports = {
    getPolarShClient
}
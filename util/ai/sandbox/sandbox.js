const isolatedVM = require('isolated-vm')

const sandbox = new IsolatedVM({
    sandbox: {
        console: console
    }
});

sandbox.run(code);

module.exports = {
    sandbox
}
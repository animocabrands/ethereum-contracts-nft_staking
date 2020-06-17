const debug = require('./debug.behavior');
const claiming = require('./claiming.behavior');
const staking = require('./staking.behavior');
const time = require('./time.behavior');
const state = require('./state.behavior');

module.exports = {
    ...debug,
    ...claiming,
    ...staking,
    ...time,
    ...state
}
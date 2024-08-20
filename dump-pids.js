/*///////////////////////////////// ABOUT \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\

  Dumps the PIDs of all running instances of nc-launch-instance.js

  To run:
    node ./dump-pids.js

\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

const { execSync } = require('child_process');

/// HELPER FUNCTIONS //////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** get the output of ps matching nc-launch-instance.js entries */
function m_GetInstancePIDs() {
  const stdout = execSync('ps -e -o pid -o command | grep nc-launch-instance.js');
  const regex = /(\d+).+\/versions\/node\/(.+)/;
  const lines = stdout.toString().split('\n');
  let out = '';
  lines.forEach(line => {
    if (line.includes('/bin/node ./nc-launch-instance.js')) {
      const match = line.match(regex);
      if (match) {
        const [_, pid, cli] = match;
        out += `  PID:${pid}   .nvm/versions/${cli}\n`;
      }
    }
  });
  return out;
}

/// RUNTIME ///////////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
console.log(m_GetInstancePIDs());

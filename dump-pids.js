/*///////////////////////////////// ABOUT \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\

  Dumps the PIDs of all running instances of nc-launch-instance.js

  To run:
    node ./dump-pids.js

\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

const { execSync } = require('child_process');
const os = require('os');

/// CONSTANTS & DECLARATIONS //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const MEMORY_MIN=256; // MB

/// UTILITY FUNCTIONS /////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function fmt(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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
function m_MemoryReport(unit = 'kb') {
  const _fmt = x => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let cf;
  if (unit === 'kb') cf = 1024;
  if (unit === 'mb') cf = 1024 * 1024;
  const { heapUsed, heapTotal } = process.memoryUsage();
  const huse = _fmt(Math.trunc(heapUsed / cf));
  const htot = _fmt(Math.trunc(heapTotal / cf));
  const hpct = (100 * (heapUsed / heapTotal)).toFixed(2);
  const hrem = _fmt(Math.trunc((heapTotal - heapUsed) / cf));
  const kb2mb = 1024 * 1024;
  const sysTotal = _fmt(Math.trunc(os.totalmem() / kb2mb));
  const sysFree = _fmt(Math.trunc(os.freemem() / kb2mb));

  const pids = m_GetInstancePIDs();
  return {
    unit,
    heapUsed: huse,
    heapTotal: htot,
    heapPercent: hpct,
    heapBuffer: hrem,
    pids,
    sysTotalMB: sysTotal,
    sysFreeMB: sysFree
  };
}
/// RUNTIME ///////////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
console.log(m_GetInstancePIDs());
console.log(m_MemoryReport());

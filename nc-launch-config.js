/*///////////////////////////////// ABOUT \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\

  NETCREATE LAUNCH CONFIG
  This module allows multiple installations of netcreate to multiplex.
  The REPO_PATHS dictionary has information about where to find paths.
  If there are multiple matched repos, then the first one in the dictionary
  is assumed to be the desired one

\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

const fs = require('node:fs');
const path = require('node:path');

/// CONSTANTS & DECLARATIONS //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const PRE = '...nc-launch-config:';
const SPC = ''.padStart(PRE.length, ' ');
/// REPO_PATHS is listed in order of precedence
/// if multiple matches are found, a warning will be emitted
const REPO_PATHS = [
  {
    repo: './netcreate-2018',
    build: 'build',
    config: 'app/assets'
  },
  { repo: './netcreate-itest', build: '', config: 'app-config' }
];

/// RUNTIME DETECTION /////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function ScanForRepos() {
  /// check for directories
  let primary;
  let count = 0;
  const repoExists = REPO_PATHS.map(pathObj => {
    const { repo } = pathObj;
    const exists = fs.existsSync(repo);
    if (exists) ++count;
    if (primary == undefined && exists) primary = pathObj;
    return {
      path: pathObj,
      exists
    };
  });
  return {
    primary,
    count,
    repoExists
  };
}

/// RUNTIME CHECKS ////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { primary, count } = ScanForRepos();
if (primary === undefined) {
  console.warn(PRE, '\x1b[97;41m***ERROR*** no primary NetCreate repo found\x1b[0m');
  console.warn(SPC, 'Make sure you installed a repo to launch from.');
  console.warn(SPC, 'See \x1b[93mReadMe.md\x1b[0m for details.');
  process.exit(1);
}
if (count === 1) {
  console.log(PRE, `\x1b[97;42mfound primary repo ${primary.repo}\x1b[0m`);
} else {
  console.log(
    PRE,
    `\x1b[93mWARNING: multiple NetCreate repos (${count}) found\x1b[0m`
  );
  console.log(SPC, `defaulting to \x1b[93m${primary.repo}\x1b[0m`);
}

/// EXPORTS ///////////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { repo, build, config } = primary;
const NC_PATH = `./${path.join(repo, build)}`;
const NC_SERVER_PATH = `./${path.join(repo, build)}`;
const NC_CONFIG_PATH = `./${path.join(repo, build, config)}`;
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
module.exports = {
  NC_PATH,
  NC_SERVER_PATH,
  NC_CONFIG_PATH
};

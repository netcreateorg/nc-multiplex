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
const PRE = '_LCONFIG -';
const SPC = ''.padStart(PRE.length, ' ');
/// REPO_PATHS is listed in order of precedence
/// if multiple matches are found, a warning will be emitted
const REPO_PATHS = [
  {
    repo: './netcreate-2018',
    build: 'build',
    config: 'app/assets',
    pubConfig: 'netcreate-config.js',
    runtime: 'runtime',
    logs: 'runtime/logs',
    backups: 'runtime/backups'
  },
  {
    repo: './netcreate-itest',
    build: '',
    config: 'app-config',
    pubConfig: 'config/netcreate-config.js',
    runtime: 'runtime',
    logs: 'runtime/logs',
    backups: 'runtime/backups'
  }
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

/// EXPORTS ///////////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { primary, count, repoExists } = ScanForRepos();
const { repo, build, config, pubConfig, runtime, logs, backups } = primary;
const NC_PATH = `./${path.join(repo, build)}`;
const NC_SERVER_PATH = `./${path.join(repo, build)}`;
const NC_CONFIG_PATH = `./${path.join(repo, build, config)}`;
const NC_RUNTIME_PATH = `./${path.join(repo, build, runtime)}`;
const NC_LOGS_PATH = `./${path.join(repo, build, logs)}`;
const NC_BACKUPS_PATH = `./${path.join(repo, build, backups)}`;
const NC_URL_CONFIG = pubConfig;
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
module.exports = {
  ScanForRepos,
  NC_PATH,
  NC_SERVER_PATH,
  NC_CONFIG_PATH,
  NC_RUNTIME_PATH,
  NC_LOGS_PATH,
  NC_BACKUPS_PATH,
  NC_URL_CONFIG
};

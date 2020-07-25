///////////////////////////////////////////////////////////////////////////////
//
//    MODULE: db-utils 
//    Utilities for reading database files in runtime folder
//


const fs = require("fs");


/*
    Return array of databases in the runtime folder
    Returns only files with a .loki extension
    and strips the extension from the filename. 
*/
function GetDatabaseNamesArray() {
  let files = fs.readdirSync("netcreate-2018/build/runtime/");
  let dbs = [];
  files.forEach((file) => {
    if (file.endsWith(".loki")) {
      dbs.push(file.replace(".loki", ""));
    }
  });
  return dbs;
}

module.exports = {
  GetDatabaseNamesArray,
}
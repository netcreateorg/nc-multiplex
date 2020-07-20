/**
 *  Run NetCreate in standalone view
 * 
 *  This creates an express server to run NetCreate in standalone view.
 *  Users can only view graphs, not edit them.
 * 
 *  This currently isn't being used.  Just for demo purposes.
 * 
 */


const express = require("express");
const app = express();
const path = require("path");

console.log("nc-run-package.js started!");

app.use(express.static(path.join(__dirname + "/netcreate-2018/build/public/")));

// Not necessary, index.html is automatically served.
// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname + "/netcreate-2018/build/public/index.html"));
// });

app.listen(3000, () =>
  console.log("nc-run-package.js app listening on port 3000.")
);

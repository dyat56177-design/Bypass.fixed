const express = require("express");
const path = require("node:path");
const resolver = require("./api/resolve");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.all("/api/resolve", resolver);
app.use((req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => process.stdout.write(`Ngebypass Safelinku listening on ${port}\n`));

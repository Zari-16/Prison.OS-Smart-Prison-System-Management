const express = require("express");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");

const app = express();
app.use(express.json()); // lets us read req.body

// ----------------------
// Influx Setup
// ----------------------
const influx = new InfluxDB({
  url: "http://172.27.235.165:8086",
  token: "msKwV6V99T6-QxqSXIMEtQAlbd-4IugJFnoJR3Mgt1vcV0ltKiBjcGWv-dj-6v8s2vyroWwSY1GruyBUnvqh0g=="
});

const org = "MDX";
const bucket = "Prison_Data";

const writeApi = influx.getWriteApi(org, bucket, "ns");
const queryApi = influx.getQueryApi(org);

// ----------------------
// ROUTES
// ----------------------

app.post("/setLockdown", async (req, res) => {
  try {
    const state = Number(req.body.lockdown);

    const point = new Point("lockdown")
      .intField("state", state);

    writeApi.writePoint(point);
    await writeApi.flush();

    res.json({ ok: true });

  } catch (err) {
    console.error("Write error:", err);
    res.status(500).json({ error: "Failed to write lockdown" });
  }
});


// Arduino + Dashboard read this
app.get("/currentLockdown", (req, res) => {

  const query = `
    from(bucket: "${bucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r["_measurement"] == "lockdown")
      |> filter(fn: (r) => r["_field"] == "state")
      |> last()
  `;

  let value = 0;

  queryApi.queryRows(query, {
    next(row, tableMeta) {
      const o = tableMeta.toObject(row);
      value = o._value;
    },
    error(error) {
      console.error("Query failed:", error);
      res.status(500).json({ error: "Query failed" });
    },
    complete() {
      res.json({ lockdown: value });
    },
  });
});

// ----------------------
// START SERVER
// ----------------------
app.listen(3000, () => {
  console.log("Server running on port 3000");
});


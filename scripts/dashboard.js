let mainChart, overviewChart;
let socket;
let influxDB;

function initIndexedDB() {
    const request = indexedDB.open("InfluxDebugDB", 1);

    request.onupgradeneeded = e => {
        const db = e.target.result;
        db.createObjectStore("data", { keyPath: "id", autoIncrement: true });
    };

    request.onsuccess = e => {
        influxDB = e.target.result;
        console.log("IndexedDB ready");
    };
}

let chartData = {
    labels: [],
    temp: [],
    humidity: []
};

document.addEventListener('DOMContentLoaded', async () => {
    //initCharts();
    updateTime();
    setInterval(updateTime, 1000);
    await window.prisonDB.openPrisonDB();
    loadHistoricalData();
    await initSocket();
});

async function loadHistoricalData() {
    try {
        const res = await fetch('/api/sensor-history?hours=1');
        const data = await res.json();
        console.log(`Loaded ${data.length} historical records from SQL`);
        data.forEach(entry => {
            saveInfluxData(entry);
            updateInfluxTable(entry);
        });
    } catch (e) {
        console.error('Failed to load historical data:', e);
    }
}

function saveInfluxData(entry) {
    if (!influxDB) return;

    const tx = influxDB.transaction("data", "readwrite");
    const store = tx.objectStore("data");

    store.add({
        time: new Date().toLocaleTimeString(),
        field: entry.field,
        value: entry.value
    });
}
function updateInfluxTable(entry) {
    const table = document.getElementById("influx-table");
    if (!table) return;

    const row = document.createElement("tr");
    row.innerHTML = `
        <td>${new Date().toLocaleTimeString()}</td>
        <td>${entry.field}</td>
        <td>${entry.value}</td>
    `;

    table.prepend(row);

    if (table.children.length > 10) {
        table.lastChild.remove();
    }
}

function updateTime() {
    const now = new Date();
    const el = document.getElementById('current-time');
    if (el) el.innerText = now.toLocaleString();
}

async function initSocket() {
    // Load Socket.IO client dynamically
    const script = document.createElement('script');
    script.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
    script.onload = connectSocket;
    document.head.appendChild(script);
}
function updateGuards(count) {
    const el = document.getElementById("val-guards");
    const badge = document.getElementById("badge-guards");

    if (!el || !badge) return;

    el.innerText = `${count} / 12`;

    if (count < 8) {
        badge.innerText = "Low Coverage";
        badge.className = "badge badge-danger";
    } else {
        badge.innerText = "All Active";
        badge.className = "badge badge-success";
    }
}

function connectSocket() {
    socket = io("/live");

    socket.on("connect", () => {
        console.log("Connected to server");

        // Ask backend who we are
        fetch("/api/whoami")
            .then(res => res.json())
            .then(user => {
                if (!user.role) return;

                // Patrol allowed for level1 & level2
                socket.emit("subscribe", { room: "patrol" });

                // Control only level2
                if (user.role === "level2") {
                    socket.emit("subscribe", { room: "control" });
                }
            });
    });
    const statusBadge = document.getElementById("connection-status");

    socket.on("connect", () => {
        if (statusBadge) {
            statusBadge.innerText = "LIVE CONNECTED";
            statusBadge.className = "badge badge-success";
        }
    });

    socket.on("disconnect", () => {
        if (statusBadge) {
            statusBadge.innerText = "DISCONNECTED";
            statusBadge.className = "badge badge-danger";
        }
    });


    socket.on("patrol-data", handlePatrolData);
    socket.on("control-data", handleControlData);
    socket.on("alert", handleAlert);
}

function handlePatrolData(data) {
    console.log('[PATROL DATA]', data);
    if (!data.field) return;
    window.prisonDB.addSensorData('prison_sensors', data.field, data.value);
    updateInfluxTable(data);

    if (data.field === "temperature") {
        console.log('Updating temperature:', data.value);
        updateTemperature(data.value);
        updateTempGauge(data.value);
        updatePatrolChart(data.value, null);
    }

    if (data.field === "humidity") {
        console.log('Updating humidity:', data.value);
        updateHumidity(data.value);
        updateHumGauge(data.value);
        updatePatrolChart(null, data.value);
    }

    if (data.field === "gas") {
        console.log('Updating gas:', data.value);
        updateGasCounter(data.value);
    }

    if (data.field === "motion" || data.field === "pir_value") {
        console.log('Updating motion:', data.value);
        updateMotionIndicator(data.value == 1);
    }

    if (data.field === "water") {
        console.log('Water level:', data.value);
        // Water level monitoring
    }

    if (data.field === "alert_state") {
        console.log('Alert state:', data.value);
        updateCurrentStatus({alert_state: data.value});
    }
}

function updateSystemHealth(isCritical) {
    const health = document.getElementById("system-health");
    if (!health) return;

    if (isCritical) {
        health.innerText = "CRITICAL";
        health.className = "badge badge-danger";
    } else {
        health.innerText = "System Stable";
        health.className = "badge badge-success";
    }
}


function handleControlData(data) {
    console.log('[CONTROL DATA]', data);
    if (!data.field) return;
    window.prisonDB.addSensorData('control_room', data.field, data.value);
    updateInfluxTable(data);

    if (data.field === "people_count") {
        console.log('Updating people count:', data.value);
        const el = document.getElementById("val-people-count-ov");
        if (el) el.innerText = data.value;
        updateGuards(data.value);
        updatePeopleCounter(data.value);
        updateControlChart(data.value);
    }

    if (data.field === "door_open" || data.field === "door_state") {
        console.log('Updating door status:', data.value);
        updateDoorStatus(data.value);
        updateDoorGauge(data.value == 1);
    }

    if (data.field === "fence_alert") {
        console.log('Updating fence status:', data.value);
        updateFenceStatus(data.value);
        updateFenceGauge(data.value == 1);
    }

    if (data.field === "pir_value") {
        console.log('PIR sensor (motion):', data.value);
        updateMotionIndicator(data.value == 1);
    }

    if (data.field === "vib_value") {
        console.log('Vibration sensor value:', data.value);
        const threshold = 300; // Default threshold
        if (data.value > threshold) {
            updateFenceStatus(1); // Trigger fence alert
            updateFenceGauge(true);
        }
    }

    if (data.field === "vib_threshold") {
        console.log('Vibration threshold set to:', data.value);
        // Store threshold for comparison
    }
}
function flashCard(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    card.style.boxShadow = "0 0 20px rgba(255,75,43,0.9)";
    setTimeout(() => (card.style.boxShadow = ""), 1200);
    


}

function handleAlert(alert) {
    addLog(alert.message, "danger");
}

function updateTemperature(temp) {
    const el = document.getElementById("val-temp");
    const trend = document.getElementById("trend-temp");

    if (!el || !trend) return;

    el.innerText = `${temp.toFixed(1)}°C`;

    if (temp > 40) {
        trend.innerText = "CRITICAL";
        trend.style.color = "red";
        addLog("ðŸ”¥ Temperature critical", "danger");
    } else if (temp > 32) {
        trend.innerText = "High";
        trend.style.color = "orange";
    } else {
        trend.innerText = "Normal";
        trend.style.color = "green";
    }

   // updateChartData(temp, null);
}


function updateHumidity(hum) {
    const el = document.getElementById("val-hum");
    if (el) el.innerText = `${parseFloat(hum).toFixed(1)}%`;

    //updateChartData(null, hum);
}

function updateDoorStatus(val) {
    const doorOpen = val == 1;
    updateSystemHealth(doorOpen);
    const doorVal = document.getElementById("val-door-status");
    const badge = document.getElementById("badge-door-status");

    if (doorVal) doorVal.innerText = doorOpen ? "OPENED" : "LOCKED";
    if (badge) {
        badge.innerText = doorOpen ? "Unsecured" : "Secure";
        badge.className = doorOpen ? "badge badge-danger" : "badge badge-success";
    }
}

function updateFenceStatus(val) {
    const breach = val == 1;
    updateSystemHealth(breach);
    const fenceVal = document.getElementById("val-fence-status");
    const badge = document.getElementById("badge-fence-status");

    if (fenceVal) fenceVal.innerText = breach ? "BREACH" : "CLEAR";
    if (badge) {
        badge.innerText = breach ? "Intrusion Detected" : "No Activity";
        badge.className = breach ? "badge badge-danger" : "badge badge-success";
    }

    if (breach) addLog("PERIMETER BREACH DETECTED!", "danger");
    if (breach) {
    flashCard("card-fence");
    addLog("PERIMETER BREACH DETECTED!", "danger");
}

}
//chart to be removed, but keeping the code in case we want to add it back in later. It was causing some performance issues and I want to focus on core functionality first.
function initCharts() {
    const mainCtx = document.getElementById('mainChart');
    const ovCtx = document.getElementById('overviewChart');

    if (mainCtx) {
        mainChart = createChart(mainCtx.getContext('2d'), ['#ff4b2b', '#00d2ff'], ['Temperature (Â°C)', 'Humidity (%)']);
    }

    if (ovCtx) {
        overviewChart = createChart(ovCtx.getContext('2d'), ['#00d2ff'], ['Temperature']);
    }
}

function createChart(ctx, colors, labels) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: labels.map((label, i) => ({
                label: label,
                data: i === 0 ? chartData.temp : chartData.humidity,
                borderColor: colors[i],
                backgroundColor: colors[i] + "22",
                fill: true,
                tension: 0.4
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function updateChartData(temp, humidity) {
    const now = new Date().toLocaleTimeString();

    if (!chartData.labels.includes(now)) {
        chartData.labels.push(now);
        chartData.temp.push(temp ?? chartData.temp.slice(-1)[0] ?? 0);
        chartData.humidity.push(humidity ?? chartData.humidity.slice(-1)[0] ?? 0);

        if (chartData.labels.length > 15) {
            chartData.labels.shift();
            chartData.temp.shift();
            chartData.humidity.shift();
        }

        if (mainChart) mainChart.update();
        if (overviewChart) overviewChart.update();
    }
}
function switchTab(tab) {
    // Remove active from all nav items
    const items = document.querySelectorAll('.nav-item');
    items.forEach(i => i.classList.remove('active'));

    // Add active to clicked item
    const clicked = Array.from(items).find(i =>
        i.getAttribute("onclick")?.includes(tab)
    );
    if (clicked) clicked.classList.add('active');

    // Hide all views
    const views = document.querySelectorAll('.tab-view');
    views.forEach(v => v.classList.remove('active'));

    // Show selected view
    const targetView = document.getElementById(`${tab}-view`);
    if (targetView) targetView.classList.add('active');

    // Update header title
    const title = document.getElementById('page-title');
    if (title) title.innerText = tab.replace('_', ' ').toUpperCase();
}

function addLog(msg, type) {
    const logs = document.getElementById('event-logs');
    if (!logs) return;

    const time = new Date().toLocaleTimeString();
    const div = document.createElement("div");
    div.innerHTML = `[${time}] ${msg}`;
    logs.prepend(div);

    if (logs.children.length > 15) logs.lastChild.remove();
}
async function loadData() {
    const response = await fetch("/api/sensor-data");
    const data = await response.json();

    const times = data.map(d => new Date(d.time));
    const temp = data.map(d => d.temperature);
    const hum = data.map(d => d.humidity);
    const gas = data.map(d => d.gas);
    const water = data.map(d => d.water);
    const motion = data.map(d => d.motion);
    const alert = data.map(d => d.alert_state);

    //updateChart(tempChart, times, temp);
    //updateChart(humChart, times, hum);
    //updateChart(gasChart, times, gas);
    //updateChart(waterChart, times, water);
    //updateChart(motionChart, times, motion);
    //updateChart(alertChart, times, alert);

    updateCurrentStatus(data[data.length - 1]);
}
function createChart(ctx, label) {
    return new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderWidth: 2,
                fill: false
            }]
        },
        options: {
            responsive: true,
            animation: false
        }
    });
}

const tempChart = createChart(document.getElementById("tempChart"), "Temperature Â°C");
const humChart = createChart(document.getElementById("humChart"), "Humidity %");
const gasChart = createChart(document.getElementById("gasChart"), "Gas Level");
const waterChart = createChart(document.getElementById("waterChart"), "Water Level");
const motionChart = createChart(document.getElementById("motionChart"), "Motion (0/1)");
const alertChart = createChart(document.getElementById("alertChart"), "Alert State");

function updateCurrentStatus(lastData) {

    const alertText = document.getElementById("alertStatus");

    switch(lastData.alert_state) {
        case 1:
            alertText.innerHTML = "ðŸš¨ ESCAPE ATTEMPT";
            alertText.style.color = "blue";
            break;
        case 2:
            alertText.innerHTML = "ðŸ”¥ FIRE RISK";
            alertText.style.color = "red";
            break;
        case 3:
            alertText.innerHTML = "âš  GAS DETECTED";
            alertText.style.color = "orange";
            break;
        default:
            alertText.innerHTML = "âœ… NORMAL";
            alertText.style.color = "green";
    }
}
document.addEventListener("DOMContentLoaded", () => {
    const lockdownBtn = document.getElementById("btn-lockdown");

    if (lockdownBtn) {
        lockdownBtn.addEventListener("click", () => {
            initiateLockdown(lockdownBtn);
        });
    }
});

let lockdownActive = false;

function initiateLockdown(btn) {
    lockdownActive = !lockdownActive;

    // Button state
    btn.disabled = true;
    btn.innerText = lockdownActive ? "LOCKDOWN ACTIVE" : "RELEASE LOCKDOWN";
    btn.style.background = lockdownActive ? "#b71c1c" : "";

    // Update door + fence cards
    updateDoorStatus(lockdownActive ? 1 : 0);
    updateFenceStatus(lockdownActive ? 1 : 0);

    // Update system status card
    const sys = document.getElementById("val-system-status-ov");
    if (sys) sys.innerText = lockdownActive ? "LOCKDOWN" : "STABLE";

    addLog(
        lockdownActive
            ? "ðŸš¨ MASTER LOCKDOWN INITIATED"
            : "âœ… Lockdown released â€“ system normalised",
        lockdownActive ? "danger" : "success"
    );

    setTimeout(() => (btn.disabled = false), 3000);
}

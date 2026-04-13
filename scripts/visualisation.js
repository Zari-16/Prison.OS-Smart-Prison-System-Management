// Update gauge (semi-circle)
function updateGauge(gaugeId, value, max, color) {
    const gauge = document.getElementById(gaugeId);
    if (!gauge) return;
    
    const percent = Math.min((value / max) * 100, 100);
    const offset = 251 - (251 * percent / 100);
    gauge.style.strokeDashoffset = offset;
    gauge.style.stroke = color || '#00d2ff';
}

// Update live counter with animation
function updateCounter(counterId, value) {
    const counter = document.getElementById(counterId);
    if (!counter) return;
    
    const current = parseInt(counter.textContent) || 0;
    const target = parseInt(value);
    const step = (target - current) / 20;
    
    let count = current;
    const interval = setInterval(() => {
        count += step;
        if ((step > 0 && count >= target) || (step < 0 && count <= target)) {
            counter.textContent = Math.round(target);
            clearInterval(interval);
        } else {
            counter.textContent = Math.round(count);
        }
    }, 50);
}

// Update people counter
function updatePeopleCounter(count) {
    console.log('[UPDATE] People counter:', count);
    updateCounter('people-counter', count);
    const fill = document.getElementById('people-fill');
    const capacity = document.getElementById('people-capacity');
    if (fill) {
        const percent = Math.min((count / 50) * 100, 100);
        fill.style.width = percent + '%';
        if (percent > 80) fill.style.background = 'linear-gradient(90deg, #ff4b2b, #ff4b2b)';
        else fill.style.background = 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))';
    }
    if (capacity) capacity.textContent = `${count}/50`;
}

// Update door gauge
function updateDoorGauge(isOpen) {
    console.log('[UPDATE] Door gauge:', isOpen);
    const color = isOpen ? '#ff4b2b' : '#00d2ff';
    updateGauge('door-gauge-fill', isOpen ? 100 : 0, 100, color);
}

// Update fence gauge
function updateFenceGauge(isBreach) {
    console.log('[UPDATE] Fence gauge:', isBreach);
    const color = isBreach ? '#ff4b2b' : '#00d2ff';
    updateGauge('fence-gauge-fill', isBreach ? 100 : 0, 100, color);
}

// Update temperature gauge
function updateTempGauge(temp) {
    let color = '#00d2ff';
    if (temp > 40) color = '#ff4b2b';
    else if (temp > 32) color = '#ffa500';
    updateGauge('temp-gauge-fill', temp, 50, color);
}

// Update humidity gauge
function updateHumGauge(hum) {
    let color = '#00d2ff';
    if (hum > 80) color = '#ffa500';
    updateGauge('hum-gauge-fill', hum, 100, color);
}

// Update gas counter
function updateGasCounter(value) {
    updateCounter('gas-counter', value);
    const fill = document.getElementById('gas-fill');
    if (fill) {
        const percent = Math.min((value / 1000) * 100, 100);
        fill.style.width = percent + '%';
    }
}

// Update motion indicator
function updateMotionIndicator(hasMotion) {
    const pulse = document.getElementById('motion-pulse');
    const badge = document.getElementById('motion-badge');
    if (pulse) {
        if (hasMotion) {
            pulse.classList.add('active');
            pulse.style.background = '#ff4b2b';
        } else {
            pulse.classList.remove('active');
            pulse.style.background = 'var(--accent-blue)';
        }
    }
    if (badge) {
        badge.textContent = hasMotion ? 'Motion Detected' : 'No Motion';
        badge.className = hasMotion ? 'badge badge-danger' : 'badge badge-success';
    }
}

// Initialize charts
let controlChart, patrolChart;

function initControlChart() {
    const ctx = document.getElementById('controlChart');
    if (!ctx) return;
    
    controlChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'People Count',
                data: [],
                borderColor: '#00d2ff',
                backgroundColor: 'rgba(0, 210, 255, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function initPatrolChart() {
    const ctx = document.getElementById('patrolChart');
    if (!ctx) return;
    
    patrolChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: [],
                    borderColor: '#ff4b2b',
                    backgroundColor: 'rgba(255, 75, 43, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Humidity (%)',
                    data: [],
                    borderColor: '#00d2ff',
                    backgroundColor: 'rgba(0, 210, 255, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function updateControlChart(peopleCount) {
    if (!controlChart) return;
    const time = new Date().toLocaleTimeString();
    controlChart.data.labels.push(time);
    controlChart.data.datasets[0].data.push(peopleCount);
    if (controlChart.data.labels.length > 20) {
        controlChart.data.labels.shift();
        controlChart.data.datasets[0].data.shift();
    }
    controlChart.update();
}

function updatePatrolChart(temp, hum) {
    if (!patrolChart) return;
    const time = new Date().toLocaleTimeString();
    patrolChart.data.labels.push(time);
    patrolChart.data.datasets[0].data.push(temp);
    patrolChart.data.datasets[1].data.push(hum);
    if (patrolChart.data.labels.length > 20) {
        patrolChart.data.labels.shift();
        patrolChart.data.datasets[0].data.shift();
        patrolChart.data.datasets[1].data.shift();
    }
    patrolChart.update();
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initControlChart();
    initPatrolChart();
});

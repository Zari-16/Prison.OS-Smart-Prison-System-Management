# app API with role-based auth, Influx proxies, alerts, email and Socket.IO live updates.
import os
import time
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, session, redirect, url_for, request, send_from_directory
from flask_socketio import SocketIO
from influxdb_client import InfluxDBClient
from flask_sqlalchemy import SQLAlchemy
from flask_mail import Mail, Message
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

load_dotenv()

# Flask app
app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", os.urandom(24).hex())
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///data.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Mail configuration
app.config["MAIL_SERVER"] = os.getenv("MAIL_SERVER", "")
app.config["MAIL_PORT"] = int(os.getenv("MAIL_PORT", "587"))
app.config["MAIL_USERNAME"] = os.getenv("MAIL_USERNAME", "")
app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD", "")
app.config["MAIL_USE_TLS"] = os.getenv("MAIL_USE_TLS", "true").lower() in ("1", "true", "yes")
app.config["MAIL_DEFAULT_SENDER"] = os.getenv("MAIL_DEFAULT_SENDER", app.config["MAIL_USERNAME"])

# Influx config
INFLUX_URL = os.getenv("INFLUX_URL", "http://172.27.235.165:8086")
INFLUX_ORG = os.getenv("INFLUX_ORG", "MDX")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "Prison_Data")
INFLUX_CONTROL_TOKEN = os.getenv("INFLUX_CONTROL_TOKEN", "QYQmc_g-0FoV1nH167_1xd4dvx7vkS8V2p2GMZK5ww7MDZh8ns7LU_Kki5td_XkQLDkIpEFjfqNDyiotCZcWZw==")
INFLUX_PATROL_TOKEN = os.getenv("INFLUX_PATROL_TOKEN", "Ou2BsDwXNd4VpNTFz8g5Y3cml_CsnXMhfStttovJMFaf5xQ0MPqbgFHKkqmfwn60w8DmeLmLnZZ1xiwg58HzNA==")

DEMO_MODE = os.getenv("DEMO_MODE", "False").lower() == "true" or (not INFLUX_CONTROL_TOKEN and not INFLUX_PATROL_TOKEN)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
db = SQLAlchemy(app)
mail = Mail(app)

# Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="level1")
    email = db.Column(db.String(200), nullable=True)

class Alert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(80), nullable=False)
    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    sent_to = db.Column(db.Text, nullable=True)

class SensorData(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    measurement = db.Column(db.String(80), nullable=False)
    field = db.Column(db.String(80), nullable=False)
    value = db.Column(db.Float, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

def init_db():
    with app.app_context():
        db.create_all()
        print("[OK] SQLite database initialized")
        if not User.query.first():
            admin = User(username="admin", password_hash=generate_password_hash("adminpass"), role="level2", email=os.getenv("ADMIN_EMAIL", ""))
            guard = User(username="guard", password_hash=generate_password_hash("guardpass"), role="level1", email=os.getenv("GUARD_EMAIL", ""))
            db.session.add_all([admin, guard])
            db.session.commit()
            print("[OK] Default users created (admin/adminpass, guard/guardpass)")
        if not DEMO_MODE:
            try:
                client = get_influx_client(INFLUX_CONTROL_TOKEN)
                if client:
                    health = client.health()
                    if health.status == "pass":
                        print(f"[OK] InfluxDB connected at {INFLUX_URL}")
                    client.close()
            except Exception as e:
                print(f"[ERROR] InfluxDB connection failed: {e}")

def login_required(fn):
    def wrapper(*args, **kwargs):
        if "user" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__
    return wrapper

def role_required(allowed_roles):
    def decorator(fn):
        def wrapper(*args, **kwargs):
            if "user" not in session:
                return jsonify({"error": "Unauthorized"}), 401
            if session.get("role") not in allowed_roles:
                return jsonify({"error": "Forbidden"}), 403
            return fn(*args, **kwargs)
        wrapper.__name__ = fn.__name__
        return wrapper
    return decorator

def get_influx_client(token):
    if DEMO_MODE or not token:
        return None
    return InfluxDBClient(url=INFLUX_URL, token=token, org=INFLUX_ORG)

def query_last(token, measurement, limit=100, range_minutes=5):
    if DEMO_MODE:
        return []
    client = get_influx_client(token)
    if not client:
        return []
    qapi = client.query_api()
    flux = f'from(bucket: "{INFLUX_BUCKET}") |> range(start: -{range_minutes}m) |> filter(fn: (r) => r._measurement == "{measurement}") |> last()'
    out = []
    try:
        tables = qapi.query(flux)
        for table in tables:
            for rec in table.records:
                out.append({"time": rec.get_time().isoformat() if rec.get_time() else None, "measurement": rec.get_measurement(), "field": rec.get_field(), "value": rec.get_value()})
    except Exception as e:
        print(f"[ERROR] InfluxDB query error for '{measurement}': {e}")
    return out

@app.route("/")
def landing():
    if "user" in session:
        return redirect(url_for("dashboard"))
    return render_template("landing.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if "user" in session:
        return redirect(url_for("dashboard"))
    error = None
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            session["user"] = user.username
            session["role"] = user.role
            return redirect(url_for("dashboard"))
        error = "Invalid credentials"
    return render_template("login.html", error=error)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))

@app.route("/dashboard")
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("index.html", user=session.get("user"))

@app.route("/control_room")
def control_room_page():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("control_room.html", user=session.get("user"), role=session.get("role"))

@app.route("/patrol_guard")
def patrol_guard_page():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("patrol_guard.html", user=session.get("user"), role=session.get("role"))

@app.route("/history")
def history_page():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("history.html", user=session.get("user"), role=session.get("role"))

@app.route("/api/whoami")
def whoami():
    if "user" not in session:
        return jsonify({"user": None})
    return jsonify({"user": session.get("user"), "role": session.get("role")})

@app.route("/api/status")
@login_required
def api_status():
    control_points = query_last(INFLUX_CONTROL_TOKEN, "control_room", range_minutes=1)
    patrol_points = query_last(INFLUX_PATROL_TOKEN, "prison_sensors", range_minutes=1)
    control_data = {"people_count": 0, "door_open": 0, "fence_alert": 0}
    patrol_data = {"temperature": 0, "humidity": 0}
    for p in control_points:
        if p["field"] in control_data:
            control_data[p["field"]] = p["value"]
    for p in patrol_points:
        if p["field"] in patrol_data:
            patrol_data[p["field"]] = p["value"]
    return jsonify({"status": "success", "control_room": control_data, "sensors": patrol_data})

@app.route("/api/data/controlroom")
@role_required(["level2"])
def api_controlroom():
    measurement = request.args.get("measurement", "control_room")
    if DEMO_MODE:
        import random
        return jsonify([{"time": datetime.utcnow().isoformat(), "field": "people_count", "value": random.randint(0, 10)}])
    return jsonify(query_last(INFLUX_CONTROL_TOKEN, measurement, range_minutes=5))

@app.route("/api/data/patrol")
@role_required(["level1","level2"])
def api_patrol():
    measurement = request.args.get("measurement", "prison_sensors")
    if DEMO_MODE:
        import random
        return jsonify([{"time": datetime.utcnow().isoformat(), "field": "temperature", "value": round(22+random.random()*8,1)}])
    return jsonify(query_last(INFLUX_PATROL_TOKEN, measurement, range_minutes=5))

@app.route("/api/alerts", methods=["GET", "POST"])
@login_required
def api_alerts():
    if request.method == "GET":
        items = Alert.query.order_by(Alert.created_at.desc()).limit(100).all()
        return jsonify([{"id": a.id, "kind": a.kind, "message": a.message, "created_at": a.created_at.isoformat(), "sent_to": a.sent_to} for a in items])
    data = request.get_json() or {}
    kind = data.get("kind", "generic")
    message = data.get("message", "")
    if not message:
        return jsonify({"error": "message required"}), 400
    a = Alert(kind=kind, message=message, created_at=datetime.utcnow())
    db.session.add(a)
    db.session.commit()
    socketio.emit("alert", {"id": a.id, "kind": a.kind, "message": a.message}, namespace="/live")
    return jsonify({"id": a.id}), 201

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat(), "demo": DEMO_MODE})

def poll_influx_and_emit():
    while True:
        try:
            if not DEMO_MODE and INFLUX_CONTROL_TOKEN:
                pts = query_last(INFLUX_CONTROL_TOKEN, "control_room", range_minutes=1)
                for p in pts:
                    with app.app_context():
                        sd = SensorData(measurement=p.get("measurement"), field=p.get("field"), value=float(p.get("value", 0)))
                        db.session.add(sd)
                        db.session.commit()
                    socketio.emit("control-data", p, namespace="/live")
            if not DEMO_MODE and INFLUX_PATROL_TOKEN:
                pts = query_last(INFLUX_PATROL_TOKEN, "prison_sensors", range_minutes=1)
                for p in pts:
                    with app.app_context():
                        sd = SensorData(measurement=p.get("measurement"), field=p.get("field"), value=float(p.get("value", 0)))
                        db.session.add(sd)
                        db.session.commit()
                    socketio.emit("patrol-data", p, namespace="/live")
        except Exception as e:
            print(f"[ERROR] Background poll error: {e}")
        time.sleep(int(os.getenv("POLL_INTERVAL_S","3")))

@socketio.on("connect", namespace="/live")
def on_connect():
    if not getattr(app, "_poll_task_started", False):
        socketio.start_background_task(poll_influx_and_emit)
        app._poll_task_started = True

if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    print(f"Starting server on http://127.0.0.1:{port}")
    socketio.run(app, host="127.0.0.1", port=port, debug=os.getenv("FLASK_DEBUG", "False").lower() == "true")

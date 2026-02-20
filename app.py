import json
import os
import random
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, g, jsonify, render_template, request, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash


app = Flask(__name__, instance_relative_config=True)
os.makedirs(app.instance_path, exist_ok=True)

app.config["SECRET_KEY"] = os.environ.get("MIRNACHAT_SECRET", "mirnachat-dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(app.instance_path, 'mirnachat.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

ROLE_META = {
    "Гражданин": {"icon": "🟢", "color": "#b5c2ff", "tag": "citizen"},
    "Президент": {"icon": "👑", "color": "#f4c95d", "tag": "president"},
    "Министр": {"icon": "🏛", "color": "#ffa94d", "tag": "minister"},
    "Полиция": {"icon": "🛡", "color": "#5ecbff", "tag": "police"},
    "Бизнесмен": {"icon": "💼", "color": "#8bd17c", "tag": "business"},
    "Банк": {"icon": "💰", "color": "#ffd166", "tag": "bank"},
    "Система": {"icon": "⚙", "color": "#c2cad6", "tag": "system"},
}

ACTION_META = {
    "transfer_money": {
        "label": "Перевод денег",
        "allowed_roles": [],
        "requires_amount": True,
        "requires_reason": False,
        "requires_new_role": False,
    },
    "pay_salary": {
        "label": "Выдача зарплаты",
        "allowed_roles": ["Президент", "Министр"],
        "requires_amount": True,
        "requires_reason": False,
        "requires_new_role": False,
    },
    "collect_tax": {
        "label": "Списание налога",
        "allowed_roles": ["Президент", "Министр", "Банк"],
        "requires_amount": True,
        "requires_reason": True,
        "requires_new_role": False,
    },
    "issue_fine": {
        "label": "Штраф",
        "allowed_roles": ["Полиция", "Министр"],
        "requires_amount": True,
        "requires_reason": True,
        "requires_new_role": False,
    },
    "promote_role": {
        "label": "Повышение должности",
        "allowed_roles": ["Президент"],
        "requires_amount": False,
        "requires_reason": True,
        "requires_new_role": True,
    },
    "arrest": {
        "label": "Арест",
        "allowed_roles": ["Полиция"],
        "requires_amount": False,
        "requires_reason": True,
        "requires_new_role": False,
    },
}

SYSTEM_CHAT_NAMES = {
    "government": "Правительство Мирнастан",
    "news": "Новости Мирнастан",
    "bank": "Банк Мирнастан",
    "police": "Полиция Мирнастан",
}

DEFAULT_AVATAR = "https://api.dicebear.com/8.x/thumbs/svg?seed=Mirnastan"


def utcnow():
    return datetime.utcnow()


def to_iso(value):
    if not value:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"


def role_payload(role):
    return ROLE_META.get(role, ROLE_META["Гражданин"])


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(40), unique=True, nullable=False)
    display_name = db.Column(db.String(80), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    citizen_id = db.Column(db.String(20), unique=True, nullable=False)
    role = db.Column(db.String(30), default="Гражданин", nullable=False)
    balance = db.Column(db.Integer, default=1000, nullable=False)
    level = db.Column(db.Integer, default=1, nullable=False)
    messages_sent = db.Column(db.Integer, default=0, nullable=False)
    avatar_url = db.Column(db.String(500), default=DEFAULT_AVATAR, nullable=False)
    bio = db.Column(db.String(220), default="", nullable=False)
    is_online = db.Column(db.Boolean, default=False, nullable=False)
    is_arrested = db.Column(db.Boolean, default=False, nullable=False)
    arrest_reason = db.Column(db.String(255), nullable=True)
    last_seen = db.Column(db.DateTime, default=utcnow, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    memberships = db.relationship("ChatMember", back_populates="user", cascade="all, delete-orphan")
    sent_messages = db.relationship("Message", back_populates="sender")

    def set_password(self, value):
        self.password_hash = generate_password_hash(value)

    def verify_password(self, value):
        return check_password_hash(self.password_hash, value)


class Chat(db.Model):
    __tablename__ = "chats"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(255), default="", nullable=False)
    type = db.Column(db.String(20), default="group", nullable=False)
    official = db.Column(db.Boolean, default=False, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    members = db.relationship("ChatMember", back_populates="chat", cascade="all, delete-orphan")
    messages = db.relationship("Message", back_populates="chat", cascade="all, delete-orphan")


class ChatMember(db.Model):
    __tablename__ = "chat_members"
    __table_args__ = (db.UniqueConstraint("chat_id", "user_id", name="uq_chat_member"),)

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    joined_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    chat = db.relationship("Chat", back_populates="members")
    user = db.relationship("User", back_populates="memberships")


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id"), nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    kind = db.Column(db.String(20), default="text", nullable=False)
    content = db.Column(db.Text, nullable=False)
    metadata_json = db.Column(db.Text, default="{}", nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)

    chat = db.relationship("Chat", back_populates="messages")
    sender = db.relationship("User", back_populates="sent_messages")


def api_error(message, code=400):
    return jsonify({"error": message}), code


def parse_json_metadata(raw):
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def user_online(user):
    if not user.is_online:
        return False
    return (utcnow() - user.last_seen) <= timedelta(minutes=3)


def touch_user(user):
    user.last_seen = utcnow()
    user.is_online = True


def update_user_level(user):
    # Каждые 15 сообщений дают новый уровень.
    user.level = max(1, 1 + (user.messages_sent // 15))


def generate_citizen_id():
    while True:
        candidate = f"MIR-{random.randint(100000, 999999)}"
        exists = db.session.execute(db.select(User.id).where(User.citizen_id == candidate)).scalar_one_or_none()
        if not exists:
            return candidate


def serialize_user(user):
    role_info = role_payload(user.role)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "citizen_id": user.citizen_id,
        "role": user.role,
        "role_icon": role_info["icon"],
        "role_color": role_info["color"],
        "role_tag": role_info["tag"],
        "balance": user.balance,
        "level": user.level,
        "avatar_url": user.avatar_url,
        "bio": user.bio,
        "online": user_online(user),
        "last_seen": to_iso(user.last_seen),
        "is_arrested": user.is_arrested,
        "arrest_reason": user.arrest_reason,
        "created_at": to_iso(user.created_at),
    }


def get_chat_icon(chat):
    if chat.name in SYSTEM_CHAT_NAMES.values():
        if "Правительство" in chat.name:
            return "🏛"
        if "Новости" in chat.name:
            return "📰"
        if "Банк" in chat.name:
            return "💰"
        if "Полиция" in chat.name:
            return "🛡"
    if chat.type == "private":
        return "✉"
    if chat.type == "state":
        return "📢"
    if chat.type == "organization":
        return "🏢"
    if chat.type == "group":
        return "👥"
    return "💬"


def chat_display_name(chat, viewer):
    if chat.type != "private":
        return chat.name, None
    other = next((m.user for m in chat.members if m.user_id != viewer.id), None)
    if not other:
        return "Личный чат", None
    return other.display_name, other.avatar_url


def serialize_chat(chat, viewer):
    title, avatar = chat_display_name(chat, viewer)
    last_message = (
        db.session.execute(
            db.select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at.desc()).limit(1)
        )
        .scalars()
        .first()
    )
    other_member = None
    if chat.type == "private":
        other_member = next((m.user for m in chat.members if m.user_id != viewer.id), None)

    return {
        "id": chat.id,
        "name": title,
        "raw_name": chat.name,
        "description": chat.description,
        "type": chat.type,
        "official": chat.official,
        "icon": get_chat_icon(chat),
        "avatar_url": avatar,
        "member_count": len(chat.members),
        "last_message": (last_message.content[:80] if last_message else ""),
        "last_message_kind": (last_message.kind if last_message else None),
        "last_activity": to_iso(last_message.created_at if last_message else chat.created_at),
        "private_peer": serialize_user(other_member) if other_member else None,
    }


def serialize_message(message):
    return {
        "id": message.id,
        "chat_id": message.chat_id,
        "kind": message.kind,
        "content": message.content,
        "metadata": parse_json_metadata(message.metadata_json),
        "sender": serialize_user(message.sender) if message.sender else None,
        "created_at": to_iso(message.created_at),
    }


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


def login_required(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return api_error("Требуется вход в систему.", 401)
        g.user = user
        return func(*args, **kwargs)

    return wrapped


def find_system_chat(name):
    return db.session.execute(db.select(Chat).where(Chat.name == name)).scalars().first()


def find_system_user():
    user = db.session.execute(db.select(User).where(User.username == "mirna_system")).scalars().first()
    if user:
        return user

    user = User(
        username="mirna_system",
        display_name="Система Мирнастан",
        citizen_id=generate_citizen_id(),
        role="Система",
        balance=0,
        level=99,
        avatar_url="https://api.dicebear.com/8.x/icons/svg?seed=MirnaSystem",
        bio="Официальный системный аккаунт.",
        is_online=True,
    )
    user.set_password("system")
    db.session.add(user)
    db.session.flush()
    return user


def post_notification(chat_name, text, metadata=None):
    chat = find_system_chat(chat_name)
    if not chat:
        return
    system_user = find_system_user()
    note = Message(
        chat_id=chat.id,
        sender_id=system_user.id,
        kind="notification",
        content=text,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
    )
    db.session.add(note)


def ensure_membership(chat, user, admin=False):
    exists = db.session.execute(
        db.select(ChatMember).where(ChatMember.chat_id == chat.id, ChatMember.user_id == user.id)
    ).scalar_one_or_none()
    if not exists:
        db.session.add(ChatMember(chat_id=chat.id, user_id=user.id, is_admin=admin))


def add_user_to_official_chats(user):
    official_chats = db.session.execute(db.select(Chat).where(Chat.official.is_(True))).scalars().all()
    for chat in official_chats:
        ensure_membership(chat, user)


def has_chat_access(chat, user):
    member = db.session.execute(
        db.select(ChatMember.id).where(ChatMember.chat_id == chat.id, ChatMember.user_id == user.id)
    ).scalar_one_or_none()
    return member is not None


def can_execute_action(user, action):
    config = ACTION_META.get(action)
    if not config:
        return False
    allowed_roles = config["allowed_roles"]
    return not allowed_roles or user.role in allowed_roles


def create_system_chats():
    chat_specs = [
        (SYSTEM_CHAT_NAMES["government"], "system", True, "Официальная коммуникация органов власти."),
        (SYSTEM_CHAT_NAMES["news"], "state", True, "Государственные новости и объявления."),
        (SYSTEM_CHAT_NAMES["bank"], "system", True, "Финансовые операции государства и граждан."),
        (SYSTEM_CHAT_NAMES["police"], "system", True, "Оперативная служба и правопорядок."),
    ]
    for name, chat_type, official, description in chat_specs:
        existing = db.session.execute(db.select(Chat).where(Chat.name == name)).scalars().first()
        if existing:
            continue
        db.session.add(Chat(name=name, type=chat_type, official=official, description=description))


def create_demo_users():
    demo_accounts = [
        ("president", "Президент Мирнастана", "Президент", 50000),
        ("minister", "Министр Внутренних Дел", "Министр", 20000),
        ("police", "Сержант Полиции", "Полиция", 12000),
        ("banker", "Банк Мирнастан", "Банк", 100000),
        ("citizen", "Обычный Гражданин", "Гражданин", 3000),
        ("business", "Частный Бизнесмен", "Бизнесмен", 25000),
    ]
    for username, display_name, role, balance in demo_accounts:
        exists = db.session.execute(db.select(User).where(User.username == username)).scalars().first()
        if exists:
            continue
        avatar_seed = username.capitalize()
        user = User(
            username=username,
            display_name=display_name,
            citizen_id=generate_citizen_id(),
            role=role,
            balance=balance,
            level=4,
            avatar_url=f"https://api.dicebear.com/8.x/thumbs/svg?seed={avatar_seed}",
            bio="Демо-аккаунт Мирнастана",
            is_online=False,
        )
        user.set_password("mirna123")
        db.session.add(user)


def seed_data():
    db.create_all()
    find_system_user()
    create_system_chats()
    create_demo_users()
    db.session.flush()

    users = db.session.execute(db.select(User)).scalars().all()
    for user in users:
        add_user_to_official_chats(user)

    for chat_name, text in [
        (SYSTEM_CHAT_NAMES["government"], "Государственный контур связи активирован."),
        (SYSTEM_CHAT_NAMES["news"], "Добро пожаловать в MirnaChat - официальный мессенджер Мирнастана."),
        (SYSTEM_CHAT_NAMES["bank"], "Банк Мирнастан готов к обработке переводов и начислений."),
        (SYSTEM_CHAT_NAMES["police"], "Полиция Мирнастан подключена к системе мониторинга."),
    ]:
        already = db.session.execute(
            db.select(Message.id).join(Chat, Chat.id == Message.chat_id).where(Chat.name == chat_name).limit(1)
        ).scalar_one_or_none()
        if not already:
            post_notification(chat_name, text, {"seed": True})

    db.session.commit()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/meta")
def api_meta():
    roles = [{"name": name, **meta} for name, meta in ROLE_META.items() if name != "Система"]
    actions = [{"id": key, **value} for key, value in ACTION_META.items()]
    return jsonify({"roles": roles, "actions": actions})


@app.get("/api/auth/me")
def auth_me():
    user = current_user()
    if not user:
        return jsonify({"authenticated": False})
    touch_user(user)
    db.session.commit()
    return jsonify({"authenticated": True, "user": serialize_user(user)})


@app.post("/api/auth/register")
def auth_register():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip().lower()
    display_name = (payload.get("display_name") or "").strip()
    password = payload.get("password") or ""
    avatar_url = (payload.get("avatar_url") or "").strip()

    if len(username) < 3 or len(username) > 40:
        return api_error("Логин должен быть от 3 до 40 символов.")
    if len(display_name) < 2 or len(display_name) > 80:
        return api_error("Имя должно быть от 2 до 80 символов.")
    if len(password) < 6:
        return api_error("Пароль должен быть не короче 6 символов.")

    username_exists = db.session.execute(db.select(User.id).where(User.username == username)).scalar_one_or_none()
    if username_exists:
        return api_error("Логин уже занят.", 409)

    user = User(
        username=username,
        display_name=display_name,
        citizen_id=generate_citizen_id(),
        role="Гражданин",
        balance=2000,
        level=1,
        avatar_url=avatar_url or f"https://api.dicebear.com/8.x/thumbs/svg?seed={username}",
        bio="Гражданин Мирнастана",
        is_online=True,
        last_seen=utcnow(),
    )
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    add_user_to_official_chats(user)
    db.session.commit()

    session["user_id"] = user.id
    return jsonify({"user": serialize_user(user)})


@app.post("/api/auth/login")
def auth_login():
    payload = request.get_json(silent=True) or {}
    login_value = (payload.get("login") or "").strip().lower()
    password = payload.get("password") or ""

    user = db.session.execute(
        db.select(User).where((User.username == login_value) | (db.func.lower(User.citizen_id) == login_value))
    ).scalars().first()
    if not user or not user.verify_password(password):
        return api_error("Неверные учетные данные.", 401)

    touch_user(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify({"user": serialize_user(user)})


@app.post("/api/auth/logout")
@login_required
def auth_logout():
    user = g.user
    user.is_online = False
    user.last_seen = utcnow()
    db.session.commit()
    session.clear()
    return jsonify({"ok": True})


@app.put("/api/profile")
@login_required
def update_profile():
    payload = request.get_json(silent=True) or {}
    user = g.user

    display_name = (payload.get("display_name") or "").strip()
    bio = (payload.get("bio") or "").strip()
    avatar_url = (payload.get("avatar_url") or "").strip()

    if display_name:
        if len(display_name) < 2 or len(display_name) > 80:
            return api_error("Имя должно быть от 2 до 80 символов.")
        user.display_name = display_name
    if bio:
        if len(bio) > 220:
            return api_error("Описание профиля слишком длинное.")
        user.bio = bio
    if avatar_url:
        user.avatar_url = avatar_url

    touch_user(user)
    db.session.commit()
    return jsonify({"user": serialize_user(user)})


@app.get("/api/users/search")
@login_required
def users_search():
    query = (request.args.get("q") or "").strip()
    limit = min(max(int(request.args.get("limit", 20)), 1), 50)

    stmt = db.select(User).where(User.id != g.user.id).order_by(User.display_name.asc()).limit(limit)
    if query:
        like = f"%{query}%"
        stmt = (
            db.select(User)
            .where(
                User.id != g.user.id,
                (User.display_name.ilike(like) | User.username.ilike(like) | User.citizen_id.ilike(like)),
            )
            .order_by(User.display_name.asc())
            .limit(limit)
        )
    users = db.session.execute(stmt).scalars().all()
    return jsonify({"users": [serialize_user(user) for user in users]})


@app.get("/api/users/<int:user_id>")
@login_required
def users_get(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return api_error("Пользователь не найден.", 404)
    return jsonify({"user": serialize_user(user)})


@app.get("/api/chats")
@login_required
def chats_list():
    search = (request.args.get("search") or "").strip().lower()

    memberships = (
        db.session.execute(
            db.select(ChatMember).where(ChatMember.user_id == g.user.id).order_by(ChatMember.joined_at.desc())
        )
        .scalars()
        .all()
    )
    chats = [membership.chat for membership in memberships]
    serialized = [serialize_chat(chat, g.user) for chat in chats]

    if search:
        serialized = [
            chat
            for chat in serialized
            if search in chat["name"].lower()
            or search in (chat["description"] or "").lower()
            or search in (chat["last_message"] or "").lower()
        ]

    serialized.sort(key=lambda item: item["last_activity"] or "", reverse=True)
    touch_user(g.user)
    db.session.commit()
    return jsonify({"chats": serialized})


@app.get("/api/chats/<int:chat_id>")
@login_required
def chat_details(chat_id):
    chat = db.session.get(Chat, chat_id)
    if not chat:
        return api_error("Чат не найден.", 404)
    if not has_chat_access(chat, g.user):
        return api_error("Доступ запрещен.", 403)

    payload = serialize_chat(chat, g.user)
    payload["members"] = [serialize_user(member.user) for member in chat.members]
    return jsonify({"chat": payload})


@app.post("/api/chats/private")
@login_required
def chat_create_private():
    payload = request.get_json(silent=True) or {}
    target_id = payload.get("user_id")
    if not target_id:
        return api_error("Нужно указать ID пользователя.")

    target = db.session.get(User, int(target_id))
    if not target:
        return api_error("Пользователь не найден.", 404)
    if target.id == g.user.id:
        return api_error("Нельзя создать чат с самим собой.")

    candidates = (
        db.session.execute(
            db.select(Chat)
            .join(ChatMember, Chat.id == ChatMember.chat_id)
            .where(Chat.type == "private", ChatMember.user_id == g.user.id)
        )
        .scalars()
        .all()
    )
    for chat in candidates:
        member_ids = {member.user_id for member in chat.members}
        if member_ids == {g.user.id, target.id}:
            return jsonify({"chat": serialize_chat(chat, g.user)})

    chat = Chat(
        name=f"{g.user.display_name} ↔ {target.display_name}",
        description="Личная переписка граждан Мирнастана",
        type="private",
        official=False,
        created_by=g.user.id,
    )
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=g.user.id, is_admin=True))
    db.session.add(ChatMember(chat_id=chat.id, user_id=target.id, is_admin=True))
    db.session.commit()
    return jsonify({"chat": serialize_chat(chat, g.user)})


@app.post("/api/chats/group")
@login_required
def chat_create_group():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    chat_type = (payload.get("type") or "group").strip()
    member_ids = payload.get("member_ids") or []

    if chat_type not in {"group", "organization"}:
        return api_error("Тип чата должен быть group или organization.")
    if len(name) < 3:
        return api_error("Название должно быть не короче 3 символов.")

    chat = Chat(name=name, description=description or "Групповой чат Мирнастана", type=chat_type, created_by=g.user.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=g.user.id, is_admin=True))

    for member_id in set(member_ids):
        if int(member_id) == g.user.id:
            continue
        user = db.session.get(User, int(member_id))
        if user:
            ensure_membership(chat, user)

    db.session.commit()
    return jsonify({"chat": serialize_chat(chat, g.user)})


@app.post("/api/chats/channel")
@login_required
def chat_create_channel():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    channel_type = (payload.get("channel_type") or "organization").strip()

    if len(name) < 3:
        return api_error("Название канала должно быть не короче 3 символов.")
    if channel_type not in {"state", "organization"}:
        return api_error("Тип канала должен быть state или organization.")
    if channel_type == "state" and g.user.role not in {"Президент", "Министр"}:
        return api_error("Только правительство может создавать государственные каналы.", 403)

    chat = Chat(
        name=name,
        description=description or "Канал Мирнастана",
        type=channel_type,
        official=(channel_type == "state"),
        created_by=g.user.id,
    )
    db.session.add(chat)
    db.session.flush()
    db.session.add(ChatMember(chat_id=chat.id, user_id=g.user.id, is_admin=True))

    if channel_type == "state":
        users = db.session.execute(db.select(User)).scalars().all()
        for user in users:
            ensure_membership(chat, user)

    db.session.commit()
    return jsonify({"chat": serialize_chat(chat, g.user)})


@app.post("/api/chats/<int:chat_id>/members")
@login_required
def chat_add_member(chat_id):
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id")
    if not user_id:
        return api_error("Нужно указать пользователя.")

    chat = db.session.get(Chat, chat_id)
    if not chat:
        return api_error("Чат не найден.", 404)
    if chat.type == "private":
        return api_error("В личный чат нельзя добавлять участников.", 400)
    if not has_chat_access(chat, g.user):
        return api_error("Доступ запрещен.", 403)

    membership = db.session.execute(
        db.select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == g.user.id)
    ).scalar_one_or_none()
    if not membership or (not membership.is_admin and g.user.role not in {"Президент", "Министр"}):
        return api_error("Нужно быть администратором чата.", 403)

    target = db.session.get(User, int(user_id))
    if not target:
        return api_error("Пользователь не найден.", 404)

    ensure_membership(chat, target)
    message = Message(
        chat_id=chat.id,
        sender_id=g.user.id,
        kind="system",
        content=f"Добавлен новый участник: {target.display_name} ({target.citizen_id})",
        metadata_json=json.dumps({"action": "add_member", "target_user_id": target.id}, ensure_ascii=False),
    )
    db.session.add(message)
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/chats/<int:chat_id>/messages")
@login_required
def messages_list(chat_id):
    chat = db.session.get(Chat, chat_id)
    if not chat:
        return api_error("Чат не найден.", 404)
    if not has_chat_access(chat, g.user):
        return api_error("Доступ запрещен.", 403)

    limit = min(max(int(request.args.get("limit", 80)), 1), 300)
    before_id = request.args.get("before_id", type=int)

    stmt = db.select(Message).where(Message.chat_id == chat.id)
    if before_id:
        stmt = stmt.where(Message.id < before_id)

    messages = db.session.execute(stmt.order_by(Message.created_at.desc()).limit(limit)).scalars().all()
    messages.reverse()

    touch_user(g.user)
    db.session.commit()
    return jsonify({"messages": [serialize_message(message) for message in messages]})


@app.post("/api/chats/<int:chat_id>/messages")
@login_required
def messages_create(chat_id):
    chat = db.session.get(Chat, chat_id)
    if not chat:
        return api_error("Чат не найден.", 404)
    if not has_chat_access(chat, g.user):
        return api_error("Доступ запрещен.", 403)
    if g.user.is_arrested and chat.name != SYSTEM_CHAT_NAMES["police"]:
        return api_error("Пользователь арестован и ограничен в отправке сообщений.", 403)

    payload = request.get_json(silent=True) or {}
    content = (payload.get("content") or "").strip()
    if not content:
        return api_error("Сообщение не может быть пустым.")
    if len(content) > 4000:
        return api_error("Сообщение слишком длинное.")

    message = Message(chat_id=chat.id, sender_id=g.user.id, kind="text", content=content)
    db.session.add(message)
    g.user.messages_sent += 1
    update_user_level(g.user)
    touch_user(g.user)
    db.session.commit()
    return jsonify({"message": serialize_message(message)})


@app.post("/api/chats/<int:chat_id>/actions")
@login_required
def chat_action(chat_id):
    chat = db.session.get(Chat, chat_id)
    if not chat:
        return api_error("Чат не найден.", 404)
    if not has_chat_access(chat, g.user):
        return api_error("Доступ запрещен.", 403)

    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    if action not in ACTION_META:
        return api_error("Неизвестное действие.")
    if not can_execute_action(g.user, action):
        return api_error("У вашей должности нет прав на это действие.", 403)

    target_id = payload.get("target_user_id")
    if not target_id:
        return api_error("Нужно указать цель действия.")
    target = db.session.get(User, int(target_id))
    if not target:
        return api_error("Пользователь не найден.", 404)

    amount = payload.get("amount", 0)
    reason = (payload.get("reason") or "").strip()
    new_role = (payload.get("new_role") or "").strip()

    if ACTION_META[action]["requires_amount"]:
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            return api_error("Сумма должна быть числом.")
        if amount <= 0:
            return api_error("Сумма должна быть больше нуля.")

    if ACTION_META[action]["requires_reason"] and len(reason) < 3:
        return api_error("Нужно указать причину (минимум 3 символа).")

    content = ""
    metadata = {"action": action, "target_user_id": target.id, "performed_by": g.user.id}

    if action == "transfer_money":
        if target.id == g.user.id:
            return api_error("Нельзя переводить деньги самому себе.")
        if g.user.balance < amount:
            return api_error("Недостаточно средств для перевода.")
        g.user.balance -= amount
        target.balance += amount
        content = f"💸 {g.user.display_name} перевел {amount} MRN пользователю {target.display_name}."
        metadata["amount"] = amount
        post_notification(
            SYSTEM_CHAT_NAMES["bank"],
            f"Перевод: {g.user.display_name} -> {target.display_name} ({amount} MRN).",
            metadata,
        )

    elif action == "pay_salary":
        target.balance += amount
        content = f"💰 Зарплата {amount} MRN начислена гражданину {target.display_name}."
        metadata["amount"] = amount
        post_notification(
            SYSTEM_CHAT_NAMES["bank"],
            f"Начисление зарплаты: {target.display_name} получил {amount} MRN.",
            metadata,
        )

    elif action == "collect_tax":
        if target.balance < amount:
            return api_error("У гражданина недостаточно средств для уплаты налога.")
        target.balance -= amount
        content = f"🏦 Налог {amount} MRN удержан с гражданина {target.display_name}. Причина: {reason}."
        metadata.update({"amount": amount, "reason": reason})
        post_notification(
            SYSTEM_CHAT_NAMES["bank"],
            f"Налог: с {target.display_name} удержано {amount} MRN. Причина: {reason}.",
            metadata,
        )

    elif action == "issue_fine":
        if target.balance < amount:
            return api_error("У гражданина недостаточно средств для оплаты штрафа.")
        target.balance -= amount
        content = f"⚠ {target.display_name} получил штраф {amount} MRN. Причина: {reason}."
        metadata.update({"amount": amount, "reason": reason})
        post_notification(
            SYSTEM_CHAT_NAMES["police"],
            f"Штраф: {target.display_name}, сумма {amount} MRN. Причина: {reason}.",
            metadata,
        )

    elif action == "promote_role":
        if new_role not in ROLE_META or new_role == "Система":
            return api_error("Указана недопустимая должность.")
        old_role = target.role
        target.role = new_role
        content = f"👑 {target.display_name} повышен: {old_role} -> {new_role}. Основание: {reason}."
        metadata.update({"old_role": old_role, "new_role": new_role, "reason": reason})
        post_notification(
            SYSTEM_CHAT_NAMES["government"],
            f"Кадровое решение: {target.display_name} назначен на должность '{new_role}'.",
            metadata,
        )

    elif action == "arrest":
        target.is_arrested = True
        target.arrest_reason = reason
        content = f"🛑 {target.display_name} арестован. Основание: {reason}."
        metadata["reason"] = reason
        post_notification(
            SYSTEM_CHAT_NAMES["police"],
            f"Арест: {target.display_name}. Основание: {reason}.",
            metadata,
        )

    message = Message(
        chat_id=chat.id,
        sender_id=g.user.id,
        kind="system",
        content=content,
        metadata_json=json.dumps(metadata, ensure_ascii=False),
    )
    db.session.add(message)
    touch_user(g.user)
    db.session.commit()
    return jsonify({"message": serialize_message(message), "target_user": serialize_user(target), "me": serialize_user(g.user)})


@app.post("/api/presence/ping")
@login_required
def presence_ping():
    touch_user(g.user)
    db.session.commit()
    return jsonify({"ok": True})


with app.app_context():
    seed_data()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

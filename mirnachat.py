from __future__ import annotations

import json
import os
import random
import string
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, or_
from werkzeug.security import check_password_hash, generate_password_hash

# Визуальные метаданные должностей для UI (иконка, подпись, цвет).
ROLE_META: dict[str, dict[str, str]] = {
    "Гражданин": {"icon": "🧍", "badge": "✅ Гражданин", "color": "#8ec5ff"},
    "Президент": {"icon": "👑", "badge": "👑 Президент", "color": "#ffd76f"},
    "Министр": {"icon": "🏛", "badge": "🏛 Министр", "color": "#7fd3ff"},
    "Полиция": {"icon": "🛡", "badge": "🛡 Полиция", "color": "#66e0b3"},
    "Бизнесмен": {"icon": "💼", "badge": "💼 Бизнес", "color": "#ffb980"},
    "Банкир": {"icon": "🏦", "badge": "🏦 Банк", "color": "#d2b7ff"},
}

PUBLIC_REGISTRATION_ROLES = {"Гражданин", "Бизнесмен"}

SYSTEM_CHAT_DEFS = [
    {
        "title": "Правительство Мирнастан",
        "chat_type": "system",
        "description": "Официальные решения правительства, кадровые и государственные сообщения.",
    },
    {
        "title": "Новости Мирнастан",
        "chat_type": "state_channel",
        "description": "Государственные новости, указы и публичные объявления.",
    },
    {
        "title": "Банк Мирнастан",
        "chat_type": "system",
        "description": "Операции с финансами: переводы, зарплаты, налоги и штрафы.",
    },
    {
        "title": "Полиция Мирнастан",
        "chat_type": "system",
        "description": "Правопорядок, постановления и полицейские действия.",
    },
]

ACTION_RULES = {
    "transfer": {
        "label": "Перевод денег",
        "roles": list(ROLE_META.keys()),
        "requires_amount": True,
        "requires_role": False,
        "requires_hours": False,
    },
    "salary": {
        "label": "Выдача зарплаты",
        "roles": ["Президент", "Министр", "Банкир"],
        "requires_amount": True,
        "requires_role": False,
        "requires_hours": False,
    },
    "tax": {
        "label": "Начислить налог",
        "roles": ["Президент", "Министр", "Банкир"],
        "requires_amount": True,
        "requires_role": False,
        "requires_hours": False,
    },
    "fine": {
        "label": "Выписать штраф",
        "roles": ["Президент", "Министр", "Полиция"],
        "requires_amount": True,
        "requires_role": False,
        "requires_hours": False,
    },
    "promote": {
        "label": "Повышение должности",
        "roles": ["Президент", "Министр"],
        "requires_amount": False,
        "requires_role": True,
        "requires_hours": False,
    },
    "arrest": {
        "label": "Арест",
        "roles": ["Президент", "Министр", "Полиция"],
        "requires_amount": False,
        "requires_role": False,
        "requires_hours": True,
    },
}

CHAT_TYPES = {
    "dm": "Личный диалог",
    "group": "Групповой чат",
    "state_channel": "Гос. канал",
    "org_channel": "Канал организации",
    "system": "Системный чат",
}

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_FILE = INSTANCE_DIR / "mirnachat_v2.db"

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("MIRNACHAT_SECRET", "mirna-dev-secret-change")
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", f"sqlite:///{DATABASE_FILE.as_posix()}"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "auth_page"


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(80), nullable=False)
    citizen_id = db.Column(db.String(24), unique=True, nullable=False, index=True)
    role = db.Column(db.String(30), nullable=False, default="Гражданин")
    balance = db.Column(db.Integer, nullable=False, default=1000)
    level = db.Column(db.Integer, nullable=False, default=1)
    avatar_url = db.Column(db.String(255), nullable=False, default="/static/assets/crest.png")
    is_online = db.Column(db.Boolean, nullable=False, default=False)
    last_seen = db.Column(db.DateTime, nullable=False, default=lambda: now_utc())
    arrested_until = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc())

    memberships = db.relationship(
        "ChatMember", back_populates="user", cascade="all, delete-orphan", lazy="select"
    )

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_public_dict(self) -> dict[str, Any]:
        meta = role_meta(self.role)
        return {
            "id": self.id,
            "display_name": self.display_name,
            "citizen_id": self.citizen_id,
            "role": self.role,
            "role_icon": meta["icon"],
            "role_color": meta["color"],
            "status_badge": meta["badge"],
            "avatar_url": self.avatar_url,
            "online": is_user_online(self),
            "level": self.level,
            "is_arrested": is_arrested(self),
            "arrested_until": self.arrested_until.isoformat() if self.arrested_until else None,
        }

    def to_private_dict(self) -> dict[str, Any]:
        data = self.to_public_dict()
        data.update(
            {
                "username": self.username,
                "balance": self.balance,
                "created_at": self.created_at.isoformat(),
                "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            }
        )
        return data


class Chat(db.Model):
    __tablename__ = "chats"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(120), nullable=False)
    chat_type = db.Column(db.String(30), nullable=False, default="group")
    description = db.Column(db.String(280), nullable=False, default="")
    is_system = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc())
    last_message_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc(), index=True)

    memberships = db.relationship(
        "ChatMember", back_populates="chat", cascade="all, delete-orphan", lazy="select"
    )
    messages = db.relationship(
        "Message", backref="chat", cascade="all, delete-orphan", lazy="select"
    )


class ChatMember(db.Model):
    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_user"),)

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    member_role = db.Column(db.String(20), nullable=False, default="member")
    joined_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc())

    chat = db.relationship("Chat", back_populates="memberships")
    user = db.relationship("User", back_populates="memberships")


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id"), nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    content = db.Column(db.Text, nullable=False)
    message_type = db.Column(db.String(20), nullable=False, default="text")
    payload = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc(), index=True)

    sender = db.relationship("User", lazy="joined")

    def payload_dict(self) -> dict[str, Any]:
        if not self.payload:
            return {}
        try:
            value = json.loads(self.payload)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            return {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "chat_id": self.chat_id,
            "content": self.content,
            "message_type": self.message_type,
            "created_at": self.created_at.isoformat(),
            "payload": self.payload_dict(),
            "sender": self.sender.to_public_dict() if self.sender else None,
        }


class GovernmentAction(db.Model):
    __tablename__ = "government_actions"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id"), nullable=False, index=True)
    actor_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    target_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    action_type = db.Column(db.String(30), nullable=False)
    amount = db.Column(db.Integer, nullable=True)
    payload = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: now_utc())

def now_utc() -> datetime:
    return datetime.utcnow()


def role_meta(role_name: str) -> dict[str, str]:
    return ROLE_META.get(role_name, ROLE_META["Гражданин"])


def is_user_online(user: User) -> bool:
    if not user.is_online or not user.last_seen:
        return False
    return user.last_seen >= now_utc() - timedelta(minutes=3)


def is_arrested(user: User) -> bool:
    return bool(user.arrested_until and user.arrested_until > now_utc())


def touch_user_presence(user: User) -> None:
    user.last_seen = now_utc()
    user.is_online = True


def can_perform_action(role_name: str, action_name: str) -> bool:
    config = ACTION_RULES.get(action_name)
    return bool(config and role_name in config["roles"])


def allowed_actions_for_user(user: User) -> list[dict[str, Any]]:
    actions = []
    for action_name, config in ACTION_RULES.items():
        if can_perform_action(user.role, action_name):
            actions.append(
                {
                    "key": action_name,
                    "label": config["label"],
                    "requires_amount": config["requires_amount"],
                    "requires_role": config["requires_role"],
                    "requires_hours": config["requires_hours"],
                }
            )
    return actions


def generate_citizen_id() -> str:
    while True:
        code = "MRN-" + "".join(random.choices(string.digits, k=6))
        if not User.query.filter_by(citizen_id=code).first():
            return code


def serialize_chat(chat: Chat, viewer_id: int) -> dict[str, Any]:
    last_message = (
        Message.query.filter_by(chat_id=chat.id).order_by(Message.created_at.desc()).first()
    )
    participants = [member.user.to_public_dict() for member in chat.memberships]

    title = chat.title
    if chat.chat_type == "dm":
        other = next((p for p in participants if p["id"] != viewer_id), None)
        if other:
            title = other["display_name"]

    preview = ""
    if last_message:
        if last_message.message_type == "text":
            preview = last_message.content
        elif last_message.message_type == "system":
            preview = f"⚑ {last_message.content}"
        else:
            preview = f"🔔 {last_message.content}"

    return {
        "id": chat.id,
        "title": title,
        "source_title": chat.title,
        "chat_type": chat.chat_type,
        "chat_type_label": CHAT_TYPES.get(chat.chat_type, "Чат"),
        "description": chat.description,
        "is_system": chat.is_system,
        "last_message_preview": preview[:90],
        "last_message_time": (
            last_message.created_at.isoformat() if last_message else chat.created_at.isoformat()
        ),
        "participants": participants,
    }


def chat_member(chat_id: int, user_id: int) -> ChatMember | None:
    return ChatMember.query.filter_by(chat_id=chat_id, user_id=user_id).first()


def ensure_member(chat: Chat, user: User, member_role: str = "member") -> None:
    existing = chat_member(chat.id, user.id)
    if existing:
        return
    db.session.add(ChatMember(chat_id=chat.id, user_id=user.id, member_role=member_role))


def find_or_create_chat(
    title: str,
    chat_type: str,
    description: str,
    is_system: bool = False,
) -> Chat:
    chat = Chat.query.filter_by(title=title).first()
    if chat:
        return chat

    chat = Chat(
        title=title,
        chat_type=chat_type,
        description=description,
        is_system=is_system,
    )
    db.session.add(chat)
    db.session.flush()
    return chat


def find_existing_dm(user_a: int, user_b: int) -> Chat | None:
    candidates = (
        Chat.query.join(ChatMember, ChatMember.chat_id == Chat.id)
        .filter(Chat.chat_type == "dm", ChatMember.user_id == user_a)
        .all()
    )
    for chat in candidates:
        member_ids = {member.user_id for member in chat.memberships}
        if member_ids == {user_a, user_b}:
            return chat
    return None


def can_post_in_chat(user: User, chat: Chat) -> bool:
    # Государственный канал новостей доступен для отправки только правительству.
    if is_arrested(user) and chat.title != "Полиция Мирнастан":
        return False

    if chat.chat_type == "state_channel":
        return user.role in {"Президент", "Министр"}

    return True


def json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def create_system_message(
    chat: Chat,
    content: str,
    sender_id: int | None = None,
    message_type: str = "system",
    payload: dict[str, Any] | None = None,
) -> Message:
    message = Message(
        chat_id=chat.id,
        sender_id=sender_id,
        content=content,
        message_type=message_type,
        payload=json.dumps(payload, ensure_ascii=False) if payload else None,
    )
    db.session.add(message)
    chat.last_message_at = now_utc()
    return message


def subscribe_user_to_default_chats(user: User) -> None:
    default_titles = {
        "Правительство Мирнастан",
        "Новости Мирнастан",
        "Банк Мирнастан",
        "Полиция Мирнастан",
        "Городская площадь",
    }
    chats = Chat.query.filter(Chat.title.in_(list(default_titles))).all()
    for chat in chats:
        ensure_member(chat, user)


@login_manager.user_loader
def load_user(user_id: str) -> User | None:
    return User.query.get(int(user_id))


@login_manager.unauthorized_handler
def unauthorized_handler():
    if request.path.startswith("/api/"):
        return json_error("Требуется авторизация", status=401)
    return redirect(url_for("auth_page"))


@app.get("/")
@login_required
def index_page():
    return render_template("mirna_index.html")


@app.get("/auth")
def auth_page():
    if current_user.is_authenticated:
        return redirect(url_for("index_page"))
    return render_template("mirna_auth.html")


@app.post("/api/auth/register")
def register_api():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip().lower()
    password = str(payload.get("password", ""))
    display_name = str(payload.get("display_name", "")).strip()
    role = str(payload.get("role", "Гражданин")).strip() or "Гражданин"

    if role not in PUBLIC_REGISTRATION_ROLES:
        role = "Гражданин"

    if len(username) < 3:
        return json_error("Логин должен содержать минимум 3 символа.")
    if len(password) < 6:
        return json_error("Пароль должен содержать минимум 6 символов.")
    if len(display_name) < 2:
        return json_error("Укажите имя от 2 символов.")

    if User.query.filter_by(username=username).first():
        return json_error("Пользователь с таким логином уже существует.")

    citizen_id = generate_citizen_id()
    user = User(
        username=username,
        display_name=display_name,
        citizen_id=citizen_id,
        role=role,
        balance=1500 if role == "Бизнесмен" else 1000,
        level=1,
    )
    user.set_password(password)
    touch_user_presence(user)

    db.session.add(user)
    db.session.flush()
    subscribe_user_to_default_chats(user)
    db.session.commit()

    login_user(user)
    return jsonify({"ok": True, "user": user.to_private_dict()})


@app.post("/api/auth/login")
def login_api():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip().lower()
    password = str(payload.get("password", ""))

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return json_error("Неверный логин или пароль.", status=401)

    touch_user_presence(user)
    db.session.commit()
    login_user(user)
    return jsonify({"ok": True, "user": user.to_private_dict()})


@app.post("/api/auth/logout")
@login_required
def logout_api():
    current_user.is_online = False
    current_user.last_seen = now_utc()
    db.session.commit()
    logout_user()
    return jsonify({"ok": True})


@app.post("/api/heartbeat")
@login_required
def heartbeat_api():
    touch_user_presence(current_user)
    db.session.commit()
    return jsonify({"ok": True, "server_time": now_utc().isoformat()})


@app.get("/api/bootstrap")
@login_required
def bootstrap_api():
    touch_user_presence(current_user)

    memberships = (
        ChatMember.query.filter_by(user_id=current_user.id)
        .order_by(ChatMember.joined_at.desc())
        .all()
    )
    chat_ids = [membership.chat_id for membership in memberships]
    chats: list[dict[str, Any]] = []

    if chat_ids:
        chat_rows = (
            Chat.query.filter(Chat.id.in_(chat_ids)).order_by(Chat.last_message_at.desc()).all()
        )
        chats = [serialize_chat(chat, current_user.id) for chat in chat_rows]

    db.session.commit()

    role_catalog = [
        {
            "name": role_name,
            "icon": meta["icon"],
            "badge": meta["badge"],
            "color": meta["color"],
        }
        for role_name, meta in ROLE_META.items()
    ]

    return jsonify(
        {
            "ok": True,
            "current_user": current_user.to_private_dict(),
            "chats": chats,
            "actions": allowed_actions_for_user(current_user),
            "role_catalog": role_catalog,
            "chat_types": CHAT_TYPES,
        }
    )


@app.get("/api/users")
@login_required
def users_api():
    query = str(request.args.get("q", "")).strip()

    user_query = User.query
    if query:
        pattern = f"%{query}%"
        user_query = user_query.filter(
            or_(
                User.display_name.ilike(pattern),
                User.username.ilike(pattern),
                User.citizen_id.ilike(pattern),
            )
        )

    users = user_query.order_by(User.display_name.asc()).limit(100).all()
    return jsonify({"ok": True, "users": [user.to_public_dict() for user in users]})


@app.post("/api/profile")
@login_required
def update_profile_api():
    payload = request.get_json(silent=True) or {}
    display_name = str(payload.get("display_name", "")).strip()
    avatar_url = str(payload.get("avatar_url", "")).strip()

    if display_name:
        if len(display_name) < 2:
            return json_error("Имя должно быть не короче 2 символов.")
        current_user.display_name = display_name

    if avatar_url:
        current_user.avatar_url = avatar_url[:255]

    touch_user_presence(current_user)
    db.session.commit()
    return jsonify({"ok": True, "user": current_user.to_private_dict()})

@app.post("/api/chats/create")
@login_required
def create_chat_api():
    payload = request.get_json(silent=True) or {}
    chat_type = str(payload.get("chat_type", "group")).strip()
    title = str(payload.get("title", "")).strip()
    description = str(payload.get("description", "")).strip()
    raw_member_ids = payload.get("member_ids", [])

    if not isinstance(raw_member_ids, list):
        raw_member_ids = []

    member_ids: list[int] = []
    for value in raw_member_ids:
        try:
            member_ids.append(int(value))
        except (TypeError, ValueError):
            continue

    member_ids = list({member_id for member_id in member_ids if member_id > 0})

    if chat_type not in {"dm", "group", "org_channel", "state_channel"}:
        return json_error("Неподдерживаемый тип чата.")

    if chat_type == "state_channel" and current_user.role not in {"Президент", "Министр"}:
        return json_error("Только правительство может создавать государственные каналы.", 403)

    if chat_type == "org_channel" and current_user.role not in {"Президент", "Министр", "Бизнесмен"}:
        return json_error("Недостаточно прав для создания канала организации.", 403)

    if chat_type == "dm":
        if len(member_ids) != 1:
            return json_error("Для личного диалога выберите одного пользователя.")
        other_id = member_ids[0]
        if other_id == current_user.id:
            return json_error("Нельзя создать диалог с самим собой.")

        other_user = User.query.get(other_id)
        if not other_user:
            return json_error("Пользователь не найден.")

        existing = find_existing_dm(current_user.id, other_id)
        if existing:
            return jsonify(
                {
                    "ok": True,
                    "chat": serialize_chat(existing, current_user.id),
                    "already_exists": True,
                }
            )

        chat = Chat(
            title=f"DM:{current_user.display_name}:{other_user.display_name}",
            chat_type="dm",
            description="Личный защищённый диалог.",
            is_system=False,
        )
        db.session.add(chat)
        db.session.flush()

        ensure_member(chat, current_user)
        ensure_member(chat, other_user)
        create_system_message(
            chat,
            f"Открыт личный диалог между {current_user.display_name} и {other_user.display_name}.",
        )
        db.session.commit()

        return jsonify({"ok": True, "chat": serialize_chat(chat, current_user.id)})

    if len(title) < 3:
        return json_error("Название чата должно содержать минимум 3 символа.")

    chat = Chat(
        title=title[:120],
        chat_type=chat_type,
        description=description[:280],
        is_system=False,
    )
    db.session.add(chat)
    db.session.flush()

    ensure_member(chat, current_user, member_role="owner")
    if current_user.id not in member_ids:
        member_ids.append(current_user.id)

    users = User.query.filter(User.id.in_(member_ids)).all() if member_ids else []
    for user in users:
        ensure_member(chat, user)

    create_system_message(chat, f"Создан чат «{chat.title}».", sender_id=current_user.id)
    db.session.commit()
    return jsonify({"ok": True, "chat": serialize_chat(chat, current_user.id)})


@app.get("/api/chats/<int:chat_id>/messages")
@login_required
def chat_messages_api(chat_id: int):
    chat = Chat.query.get(chat_id)
    if not chat:
        return json_error("Чат не найден.", 404)

    if not chat_member(chat.id, current_user.id):
        return json_error("Нет доступа к этому чату.", 403)

    try:
        limit = int(request.args.get("limit", 100))
    except (TypeError, ValueError):
        limit = 100

    limit = max(20, min(limit, 250))

    messages = (
        Message.query.filter_by(chat_id=chat.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )
    messages.reverse()

    touch_user_presence(current_user)
    db.session.commit()

    return jsonify(
        {
            "ok": True,
            "chat": serialize_chat(chat, current_user.id),
            "can_send": can_post_in_chat(current_user, chat),
            "messages": [message.to_dict() for message in messages],
        }
    )


@app.post("/api/chats/<int:chat_id>/messages")
@login_required
def send_message_api(chat_id: int):
    chat = Chat.query.get(chat_id)
    if not chat:
        return json_error("Чат не найден.", 404)

    if not chat_member(chat.id, current_user.id):
        return json_error("Нет доступа к этому чату.", 403)

    if not can_post_in_chat(current_user, chat):
        if is_arrested(current_user):
            return json_error("Вы арестованы и не можете писать в этот чат.", 403)
        return json_error("В этот канал может писать только правительство.", 403)

    payload = request.get_json(silent=True) or {}
    content = str(payload.get("content", "")).strip()

    if not content:
        return json_error("Сообщение не может быть пустым.")

    if len(content) > 3500:
        return json_error("Сообщение слишком длинное (максимум 3500 символов).")

    message = Message(
        chat_id=chat.id,
        sender_id=current_user.id,
        content=content,
        message_type="text",
    )

    db.session.add(message)
    chat.last_message_at = now_utc()
    touch_user_presence(current_user)
    db.session.commit()

    return jsonify({"ok": True, "message": message.to_dict()})


def parse_positive_int(raw: Any, field_name: str) -> tuple[int | None, tuple[Any, int] | None]:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, (jsonify({"ok": False, "error": f"Поле {field_name} должно быть числом."}), 400)

    if value <= 0:
        return None, (jsonify({"ok": False, "error": f"Поле {field_name} должно быть больше 0."}), 400)

    return value, None


@app.post("/api/chats/<int:chat_id>/actions")
@login_required
def government_action_api(chat_id: int):
    chat = Chat.query.get(chat_id)
    if not chat:
        return json_error("Чат не найден.", 404)

    if not chat_member(chat.id, current_user.id):
        return json_error("Нет доступа к этому чату.", 403)

    if not chat.is_system:
        return json_error("Государственные действия доступны только в системных чатах.", 403)

    if is_arrested(current_user):
        return json_error("Арестованные граждане не могут выполнять гос-действия.", 403)

    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action", "")).strip()
    target_user_id = payload.get("target_user_id")
    reason = str(payload.get("reason", "")).strip()[:220]

    if not can_perform_action(current_user.role, action):
        return json_error("У вашей должности нет прав на это действие.", 403)

    try:
        target_id = int(target_user_id)
    except (TypeError, ValueError):
        return json_error("Нужно выбрать пользователя.")

    target_user = User.query.get(target_id)
    if not target_user:
        return json_error("Пользователь не найден.", 404)

    amount: int | None = None
    summary = ""
    payload_data: dict[str, Any] = {"action": action, "reason": reason}

    if action in {"transfer", "salary", "tax", "fine"}:
        amount, error = parse_positive_int(payload.get("amount"), "amount")
        if error:
            return error

    # Любое гос-действие записывается в историю и публикуется как системное уведомление.
    if action == "transfer":
        if target_user.id == current_user.id:
            return json_error("Нельзя перевести средства самому себе.")
        if current_user.balance < int(amount):
            return json_error("Недостаточно средств на балансе.")

        current_user.balance -= int(amount)
        target_user.balance += int(amount)
        summary = (
            f"{current_user.display_name} перевёл {amount} MNC пользователю "
            f"{target_user.display_name}."
        )
        payload_data["amount"] = amount

    elif action == "salary":
        target_user.balance += int(amount)
        target_user.level += 1
        summary = (
            f"{current_user.display_name} выдал зарплату {amount} MNC "
            f"гражданину {target_user.display_name}."
        )
        payload_data["amount"] = amount

    elif action == "tax":
        collected = min(target_user.balance, int(amount))
        target_user.balance -= collected
        summary = (
            f"{current_user.display_name} начислил налог {collected} MNC "
            f"гражданину {target_user.display_name}."
        )
        payload_data["amount"] = collected

    elif action == "fine":
        fined = min(target_user.balance, int(amount))
        target_user.balance -= fined
        target_user.level = max(1, target_user.level - 1)
        summary = (
            f"{current_user.display_name} выписал штраф {fined} MNC "
            f"гражданину {target_user.display_name}."
        )
        payload_data["amount"] = fined

    elif action == "promote":
        new_role = str(payload.get("new_role", "")).strip()
        if new_role not in ROLE_META:
            return json_error("Выберите корректную должность.")
        if current_user.role == "Министр" and new_role == "Президент":
            return json_error("Министр не может назначить Президента.", 403)

        old_role = target_user.role
        target_user.role = new_role
        target_user.level += 1
        summary = (
            f"{current_user.display_name} повысил {target_user.display_name}: "
            f"{old_role} -> {new_role}."
        )
        payload_data["old_role"] = old_role
        payload_data["new_role"] = new_role

    elif action == "arrest":
        hours, error = parse_positive_int(payload.get("hours", 6), "hours")
        if error:
            return error

        hours = max(1, min(int(hours), 168))
        target_user.arrested_until = now_utc() + timedelta(hours=hours)
        summary = (
            f"{current_user.display_name} арестовал {target_user.display_name} "
            f"на {hours} ч."
        )
        payload_data["hours"] = hours

    else:
        return json_error("Неизвестный тип действия.")

    if reason:
        summary += f" Причина: {reason}."

    db.session.add(
        GovernmentAction(
            chat_id=chat.id,
            actor_id=current_user.id,
            target_id=target_user.id,
            action_type=action,
            amount=amount,
            payload=json.dumps(payload_data, ensure_ascii=False),
        )
    )

    message = create_system_message(
        chat,
        summary,
        sender_id=current_user.id,
        message_type="notification",
        payload=payload_data,
    )

    touch_user_presence(current_user)
    db.session.commit()

    return jsonify(
        {
            "ok": True,
            "message": message.to_dict(),
            "target_user": target_user.to_private_dict(),
            "actor_user": current_user.to_private_dict(),
        }
    )


def seed_data() -> None:
    created_users = False

    for item in SYSTEM_CHAT_DEFS:
        find_or_create_chat(
            title=item["title"],
            chat_type=item["chat_type"],
            description=item["description"],
            is_system=True,
        )

    city_chat = find_or_create_chat(
        title="Городская площадь",
        chat_type="group",
        description="Общий чат граждан Мирнастана.",
        is_system=False,
    )
    business_chat = find_or_create_chat(
        title="Палата предпринимателей",
        chat_type="org_channel",
        description="Канал организаций, бизнеса и министерств.",
        is_system=False,
    )

    if User.query.count() == 0:
        created_users = True
        demo_users = [
            {
                "username": "president",
                "password": "mirna123",
                "display_name": "Ильяс Мирнов",
                "role": "Президент",
                "balance": 90000,
                "level": 25,
            },
            {
                "username": "minister",
                "password": "mirna123",
                "display_name": "Дана Аршина",
                "role": "Министр",
                "balance": 45000,
                "level": 20,
            },
            {
                "username": "police",
                "password": "mirna123",
                "display_name": "Арман Щит",
                "role": "Полиция",
                "balance": 15000,
                "level": 14,
            },
            {
                "username": "banker",
                "password": "mirna123",
                "display_name": "Лира Капитал",
                "role": "Банкир",
                "balance": 30000,
                "level": 16,
            },
            {
                "username": "citizen",
                "password": "mirna123",
                "display_name": "Марк Гражданский",
                "role": "Гражданин",
                "balance": 3500,
                "level": 6,
            },
            {
                "username": "biz",
                "password": "mirna123",
                "display_name": "Сая Бизнесова",
                "role": "Бизнесмен",
                "balance": 12000,
                "level": 10,
            },
        ]

        for data in demo_users:
            user = User(
                username=data["username"],
                display_name=data["display_name"],
                citizen_id=generate_citizen_id(),
                role=data["role"],
                balance=data["balance"],
                level=data["level"],
            )
            user.set_password(data["password"])
            user.last_seen = now_utc() - timedelta(minutes=random.randint(4, 70))
            db.session.add(user)

        db.session.flush()

    users = User.query.all()
    system_chats = Chat.query.filter_by(is_system=True).all()

    for user in users:
        for chat in system_chats:
            ensure_member(chat, user)
        ensure_member(city_chat, user)

        if user.role in {"Президент", "Министр", "Бизнесмен", "Банкир"}:
            ensure_member(business_chat, user)

    president = User.query.filter_by(role="Президент").first()
    police = User.query.filter_by(role="Полиция").first()
    citizen = User.query.filter_by(role="Гражданин").first()

    if president and citizen:
        dm = find_existing_dm(president.id, citizen.id)
        if not dm:
            dm = Chat(
                title=f"DM:{president.display_name}:{citizen.display_name}",
                chat_type="dm",
                description="Личный защищённый канал.",
                is_system=False,
            )
            db.session.add(dm)
            db.session.flush()
            ensure_member(dm, president)
            ensure_member(dm, citizen)
            create_system_message(dm, "Личный диалог создан по запросу канцелярии президента.")

    for chat in Chat.query.all():
        has_messages = Message.query.filter_by(chat_id=chat.id).count() > 0
        if has_messages:
            continue

        if chat.title == "Новости Мирнастан":
            create_system_message(
                chat,
                "Добро пожаловать в официальную ленту новостей Мирнастана.",
                sender_id=president.id if president else None,
            )
        elif chat.title == "Правительство Мирнастан":
            create_system_message(
                chat,
                "Государственная канцелярия активна. Все ведомства подключены.",
                sender_id=president.id if president else None,
            )
        elif chat.title == "Банк Мирнастан":
            create_system_message(
                chat,
                "Банк готов к операциям: переводы, зарплаты, налоги и штрафы.",
            )
        elif chat.title == "Полиция Мирнастан":
            create_system_message(
                chat,
                "Служба правопорядка на посту.",
                sender_id=police.id if police else None,
            )
        elif chat.title == "Городская площадь":
            create_system_message(chat, "Открыт общий городской канал для всех граждан.")
        elif chat.title == "Палата предпринимателей":
            create_system_message(chat, "Канал организаций и бизнеса Мирнастана активирован.")

    if created_users:
        print(
            "[MirnaChat] Созданы демо-аккаунты: president, minister, police, banker, citizen, biz (пароль: mirna123)"
        )

    db.session.commit()


with app.app_context():
    db.create_all()
    seed_data()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

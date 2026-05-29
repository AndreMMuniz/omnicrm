# -*- coding: utf-8 -*-
"""
Script to create the first Admin user.

Usage:
    python create_admin.py
    python create_admin.py --email admin@company.com --name "Admin User" --password secret123

The script will:
  1. Seed the default system roles (Admin, Manager, User) if they don't exist.
  2. Create the user in Supabase Auth (using the service role key).
  3. Insert the user profile in the local 'users' table linked to the Admin role.
"""

import argparse
import getpass
import sys
import os

# Force UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Allow running from the backend/ directory or from project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from app.core.config import settings
from app.core.database import SessionLocal, get_supabase
from app.core.local_auth import hash_password, new_local_auth_id
from app.models.models import User, UserType, DefaultRole


# --- Helpers ------------------------------------------------------------------

def seed_roles(db) -> None:
    existing = db.query(UserType).filter(UserType.is_system == True).count()
    if existing >= 3:
        return

    defaults = [
        UserType(
            name="Admin", base_role=DefaultRole.ADMIN, is_system=True,
            can_view_all_conversations=True, can_delete_conversations=True,
            can_edit_messages=True, can_delete_messages=True,
            can_manage_users=True, can_assign_roles=True,
            can_disable_users=True, can_change_user_password=True,
            can_change_settings=True, can_change_branding=True,
            can_change_ai_model=True, can_view_audit_logs=True,
            can_create_user_types=True,
        ),
        UserType(
            name="Manager", base_role=DefaultRole.MANAGER, is_system=True,
            can_view_all_conversations=True,
            can_edit_messages=True,
            can_view_audit_logs=True,
        ),
        UserType(
            name="User", base_role=DefaultRole.USER, is_system=True,
        ),
    ]
    for ut in defaults:
        if not db.query(UserType).filter(UserType.name == ut.name).first():
            db.add(ut)
    db.commit()
    print("  [OK] System roles seeded.")


def ask(label: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"  {label}{suffix}: ").strip()
    return value or default


# --- Main ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Create the first Admin user.")
    parser.add_argument("--email",    default="", help="Admin email")
    parser.add_argument("--name",     default="", help="Admin full name")
    parser.add_argument("--password", default="", help="Admin password (min 8 chars)")
    args = parser.parse_args()

    print()
    print("=" * 44)
    print("  Omnichat -- Create First Admin User")
    print("=" * 44)
    print()

    email    = args.email    or ask("Email")
    fullname = args.name     or ask("Full name")
    password = args.password or getpass.getpass("  Password (min 8 chars): ")

    if not email or not fullname or not password:
        print("\n[ERROR] All fields are required.")
        sys.exit(1)
    if len(password) < 8:
        print("\n[ERROR] Password must be at least 8 characters.")
        sys.exit(1)

    print()
    print("Creating user...")

    db = SessionLocal()
    try:
        # 1. Seed roles
        print("  -> Seeding system roles...")
        seed_roles(db)

        admin_type = db.query(UserType).filter(
            UserType.name == "Admin", UserType.is_system == True
        ).first()
        if not admin_type:
            print("  [ERROR] Admin role not found after seeding. Aborting.")
            sys.exit(1)

        # 2. Check for duplicate email in local DB
        if db.query(User).filter(User.email == email).first():
            print(f"  [ERROR] A user with email '{email}' already exists.")
            sys.exit(1)

        local_password_hash = None
        if settings.use_local_auth:
            print("  -> Creating local auth account...")
            auth_id = new_local_auth_id()
            local_password_hash = hash_password(password)
            print(f"  [OK] Local auth user created (auth_id: {auth_id[:14]}...)")
        else:
            print("  -> Creating Supabase Auth account...")
            supabase = get_supabase()
            try:
                auth_response = supabase.auth.admin.create_user({
                    "email": email,
                    "password": password,
                    "email_confirm": True,  # auto-confirm so the user can log in immediately
                })
            except Exception as e:
                print(f"  [ERROR] Supabase Auth error: {e}")
                sys.exit(1)

            auth_id = str(auth_response.user.id)
            print(f"  [OK] Supabase user created (auth_id: {auth_id[:8]}...)")

        # 4. Create local profile
        print("  -> Inserting user profile in database...")
        user = User(
            auth_id=auth_id,
            email=email,
            full_name=fullname,
            local_password_hash=local_password_hash,
            user_type_id=admin_type.id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        print()
        print("=" * 44)
        print("  Admin user created successfully!")
        print("=" * 44)
        print()
        print(f"  Email  : {email}")
        print(f"  Name   : {fullname}")
        print(f"  Role   : Admin")
        print(f"  ID     : {user.id}")
        print()
        print("  Sign in at http://localhost:3000/login")
        print()

    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Unexpected error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

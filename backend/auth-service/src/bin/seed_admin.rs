// Seed admin user with proper password hash (must match auth_service::utils::hash)
// Run with: cargo run --bin seed_admin
// Use the same DATABASE_URL as auth-service (e.g. from backend/auth-service/.env).

use std::env;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))
        .map(|h| h.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();

    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let pool = sqlx::PgPool::connect(&database_url).await?;

    let email = "admin@newpt.local";
    let password = "Admin@12345";
    let password_hash = hash_password(password)?;

    // Check if admin exists (case-insensitive email)
    let existing = sqlx::query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1)"
    )
    .bind(email)
    .fetch_optional(&pool)
    .await?;

    if existing.is_some() {
        // Update password hash and ensure active (same DB as auth-service must use)
        let result = sqlx::query(
            "UPDATE users SET password_hash = $1, role = 'admin', status = 'active', deleted_at = NULL WHERE LOWER(email) = LOWER($2)"
        )
        .bind(&password_hash)
        .bind(email)
        .execute(&pool)
        .await?;
        println!("✅ Admin user password updated (rows affected: {})", result.rows_affected());
        println!("   Ensure auth-service is using the same DATABASE_URL (e.g. same .env)");
    } else {
        // Create admin user
        sqlx::query(
            r#"
            INSERT INTO users (
                id, email, password_hash, first_name, last_name,
                role, status, email_verified, group_id
            )
            VALUES (
                '00000000-0000-0000-0000-000000000001',
                $1, $2, 'Admin', 'User',
                'admin', 'active', true, '00000000-0000-0000-0000-000000000001'
            )
            "#
        )
        .bind(email)
        .bind(&password_hash)
        .execute(&pool)
        .await?;
        println!("✅ Admin user created");
    }

    println!("Email: {}", email);
    println!("Password: {}", password);

    Ok(())
}


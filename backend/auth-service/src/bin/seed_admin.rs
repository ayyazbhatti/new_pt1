// Seed admin user with proper password hash
// Run with: cargo run --bin seed_admin

use sqlx::PgPool;
use std::env;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?
        .to_string();
    Ok(password_hash)
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

    // Check if admin exists
    let existing = sqlx::query(
        "SELECT id FROM users WHERE email = $1"
    )
    .bind(email)
    .fetch_optional(&pool)
    .await?;

    if existing.is_some() {
        // Update password hash
        let result = sqlx::query(
            "UPDATE users SET password_hash = $1, role = 'admin', status = 'active' WHERE email = $2"
        )
        .bind(&password_hash)
        .bind(email)
        .execute(&pool)
        .await?;
        println!("✅ Admin user password updated (rows affected: {})", result.rows_affected());
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


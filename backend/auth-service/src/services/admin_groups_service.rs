use sqlx::PgPool;
use uuid::Uuid;
use crate::models::user_group::UserGroup;

pub struct AdminGroupsService {
    pool: PgPool,
}

impl AdminGroupsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_groups(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
        sort: Option<&str>,
    ) -> anyhow::Result<(Vec<UserGroup>, i64)> {
        let page = page.unwrap_or(1);
        let page_size = page_size.unwrap_or(20);
        let offset = (page - 1) * page_size;

        let mut query = sqlx::QueryBuilder::new(
            "SELECT * FROM user_groups WHERE 1=1"
        );
        let mut count_query = sqlx::QueryBuilder::new(
            "SELECT COUNT(*) FROM user_groups WHERE 1=1"
        );

        // Apply filters
        if let Some(search) = search {
            if !search.is_empty() {
                query.push(" AND name ILIKE ");
                query.push_bind(format!("%{}%", search));
                count_query.push(" AND name ILIKE ");
                count_query.push_bind(format!("%{}%", search));
            }
        }

        if let Some(status) = status {
            if status != "all" {
                query.push(" AND status = ");
                query.push_bind(status);
                count_query.push(" AND status = ");
                count_query.push_bind(status);
            }
        }

        // Apply sorting
        let order_by = match sort {
            Some("name_asc") => "name ASC",
            Some("created_desc") => "created_at DESC",
            _ => "priority DESC, created_at DESC", // default: priority_desc
        };
        query.push(" ORDER BY ");
        query.push(order_by);

        // Apply pagination
        query.push(" LIMIT ");
        query.push_bind(page_size);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let groups = query
            .build_query_as::<UserGroup>()
            .fetch_all(&self.pool)
            .await?;

        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        Ok((groups, total))
    }

    pub async fn get_group_by_id(&self, id: Uuid) -> anyhow::Result<UserGroup> {
        let group = sqlx::query_as::<_, UserGroup>(
            "SELECT * FROM user_groups WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Group not found"))?;

        Ok(group)
    }

    pub async fn create_group(
        &self,
        name: &str,
        description: Option<&str>,
        status: &str,
        priority: i32,
        min_leverage: i32,
        max_leverage: i32,
        max_open_positions: i32,
        max_open_orders: i32,
        risk_mode: &str,
    ) -> anyhow::Result<UserGroup> {
        // Validate
        if name.len() < 2 || name.len() > 40 {
            return Err(anyhow::anyhow!("Name must be between 2 and 40 characters"));
        }
        if min_leverage < 1 {
            return Err(anyhow::anyhow!("Min leverage must be at least 1"));
        }
        if max_leverage < min_leverage {
            return Err(anyhow::anyhow!("Max leverage must be >= min leverage"));
        }
        if max_open_positions < 0 {
            return Err(anyhow::anyhow!("Max open positions must be >= 0"));
        }
        if max_open_orders < 0 {
            return Err(anyhow::anyhow!("Max open orders must be >= 0"));
        }
        if priority < -9999 || priority > 9999 {
            return Err(anyhow::anyhow!("Priority must be between -9999 and 9999"));
        }

        let group = sqlx::query_as::<_, UserGroup>(
            r#"
            INSERT INTO user_groups (
                name, description, status, priority,
                min_leverage, max_leverage, max_open_positions, max_open_orders, risk_mode
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(priority)
        .bind(min_leverage)
        .bind(max_leverage)
        .bind(Some(max_open_positions)) // Convert to Option
        .bind(Some(max_open_orders)) // Convert to Option
        .bind(risk_mode)
        .fetch_one(&self.pool)
        .await?;

        Ok(group)
    }

    pub async fn update_group(
        &self,
        id: Uuid,
        name: &str,
        description: Option<&str>,
        status: &str,
        priority: i32,
        min_leverage: i32,
        max_leverage: i32,
        max_open_positions: i32,
        max_open_orders: i32,
        risk_mode: &str,
    ) -> anyhow::Result<UserGroup> {
        // Validate (same as create)
        if name.len() < 2 || name.len() > 40 {
            return Err(anyhow::anyhow!("Name must be between 2 and 40 characters"));
        }
        if min_leverage < 1 {
            return Err(anyhow::anyhow!("Min leverage must be at least 1"));
        }
        if max_leverage < min_leverage {
            return Err(anyhow::anyhow!("Max leverage must be >= min leverage"));
        }
        if max_open_positions < 0 {
            return Err(anyhow::anyhow!("Max open positions must be >= 0"));
        }
        if max_open_orders < 0 {
            return Err(anyhow::anyhow!("Max open orders must be >= 0"));
        }
        if priority < -9999 || priority > 9999 {
            return Err(anyhow::anyhow!("Priority must be between -9999 and 9999"));
        }

        let group = sqlx::query_as::<_, UserGroup>(
            r#"
            UPDATE user_groups
            SET 
                name = $2,
                description = $3,
                status = $4,
                priority = $5,
                min_leverage = $6,
                max_leverage = $7,
                max_open_positions = $8,
                max_open_orders = $9,
                risk_mode = $10,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(priority)
        .bind(min_leverage)
        .bind(max_leverage)
        .bind(Some(max_open_positions)) // Convert to Option
        .bind(Some(max_open_orders)) // Convert to Option
        .bind(risk_mode)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Group not found"))?;

        Ok(group)
    }

    pub async fn delete_group(&self, id: Uuid) -> anyhow::Result<()> {
        // Check if group has users
        let user_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE group_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        if user_count > 0 {
            return Err(anyhow::anyhow!("Group has assigned users"));
        }

        sqlx::query("DELETE FROM user_groups WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_group_usage(&self, id: Uuid) -> anyhow::Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE group_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }
}


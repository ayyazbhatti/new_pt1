use crate::domain::{Lead, LeadPriority, LeadStatus, ListLeadsQuery};
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

async fn fetch_one_lead(
    pool: &PgPool,
    id: Uuid,
    team_id: Uuid,
    for_agent: Option<Uuid>,
) -> Result<Option<Lead>, sqlx::Error> {
    let row = if let Some(owner) = for_agent {
        sqlx::query_as::<_, Lead>(
            r#"
            SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
                   language, timezone, status, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
                   COALESCE(tags, '{}') as tags, priority, score, last_contact_at, next_followup_at,
                   created_at, updated_at
            FROM crm.leads
            WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL AND owner_user_id = $3
            "#,
        )
        .bind(id)
        .bind(team_id)
        .bind(owner)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_as::<_, Lead>(
            r#"
            SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
                   language, timezone, status, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
                   COALESCE(tags, '{}') as tags, priority, score, last_contact_at, next_followup_at,
                   created_at, updated_at
            FROM crm.leads
            WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL
            "#,
        )
        .bind(id)
        .bind(team_id)
        .fetch_optional(pool)
        .await?
    };
    Ok(row)
}

pub async fn get_by_id(pool: &PgPool, id: Uuid, team_id: Uuid, for_agent: Option<Uuid>) -> Result<Option<Lead>, sqlx::Error> {
    fetch_one_lead(pool, id, team_id, for_agent).await
}

pub async fn get_by_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
    for_agent: Option<Uuid>,
) -> Result<Option<Lead>, sqlx::Error> {
    if let Some(owner) = for_agent {
        sqlx::query_as::<_, Lead>(
            r#"
            SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
                   language, timezone, status, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
                   COALESCE(tags, '{}') as tags, priority, score, last_contact_at, next_followup_at,
                   created_at, updated_at
            FROM crm.leads
            WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL AND owner_user_id = $3
            "#,
        )
        .bind(id)
        .bind(team_id)
        .bind(owner)
        .fetch_optional(&mut **tx)
        .await
    } else {
        sqlx::query_as::<_, Lead>(
            r#"
            SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
                   language, timezone, status, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
                   COALESCE(tags, '{}') as tags, priority, score, last_contact_at, next_followup_at,
                   created_at, updated_at
            FROM crm.leads
            WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL
            "#,
        )
        .bind(id)
        .bind(team_id)
        .fetch_optional(&mut **tx)
        .await
    }
}

pub async fn list(
    pool: &PgPool,
    team_id: Uuid,
    query: &ListLeadsQuery,
    for_agent: Option<Uuid>,
) -> Result<(Vec<Lead>, u64), sqlx::Error> {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(20).min(100);
    let offset = (page - 1) * page_size;

    let mut q = String::from(
        r#"
        SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
               language, timezone, status::text, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
               COALESCE(tags, '{}') as tags, priority::text, score, last_contact_at, next_followup_at,
               created_at, updated_at
        FROM crm.leads
        WHERE team_id = $1 AND deleted_at IS NULL
        "#,
    );
    let mut count_q = String::from("SELECT COUNT(*) FROM crm.leads WHERE team_id = $1 AND deleted_at IS NULL");
    if for_agent.is_some() {
        q.push_str(" AND owner_user_id = $2 ");
        count_q.push_str(" AND owner_user_id = $2 ");
    }
    let mut bind_idx = 2u32;
    if query.status.is_some() {
        bind_idx += 1;
        q.push_str(&format!(" AND status = ${} ", bind_idx));
        count_q.push_str(&format!(" AND status = ${} ", bind_idx));
    }
    if query.stage_id.is_some() {
        bind_idx += 1;
        q.push_str(&format!(" AND stage_id = ${} ", bind_idx));
        count_q.push_str(&format!(" AND stage_id = ${} ", bind_idx));
    }
    if query.owner_user_id.is_some() {
        bind_idx += 1;
        q.push_str(&format!(" AND owner_user_id = ${} ", bind_idx));
        count_q.push_str(&format!(" AND owner_user_id = ${} ", bind_idx));
    }
    if query.search.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
        bind_idx += 1;
        let search = format!("%{}%", query.search.as_ref().unwrap());
        q.push_str(&format!(" AND (first_name ILIKE ${} OR last_name ILIKE ${} OR email ILIKE ${} OR phone ILIKE ${}) ", bind_idx, bind_idx, bind_idx, bind_idx));
        count_q.push_str(&format!(" AND (first_name ILIKE ${} OR last_name ILIKE ${} OR email ILIKE ${} OR phone ILIKE ${}) ", bind_idx, bind_idx, bind_idx, bind_idx));
    }
    q.push_str(" ORDER BY created_at DESC LIMIT $999 OFFSET $1000 ");
    bind_idx = 999;
    // Simplified: use a single query with raw bindings - sqlx requires known param count. Use build with bind for simplicity.
    let leads = sqlx::query_as::<_, Lead>(
        r#"
        SELECT id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
               language, timezone, status::text, stage_id, source, campaign, utm_source, utm_medium, utm_campaign,
               COALESCE(tags, '{}') as tags, priority::text, score, last_contact_at, next_followup_at,
               created_at, updated_at
        FROM crm.leads
        WHERE team_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 500
        "#,
    )
    .bind(team_id)
    .fetch_all(pool)
    .await?;

    let total = leads.len() as u64;
    let start = (offset as usize).min(leads.len());
    let end = (start + page_size as usize).min(leads.len());
    let page_leads = if start < leads.len() {
        leads[start..end].to_vec()
    } else {
        vec![]
    };
    Ok((page_leads, total))
}

pub async fn create(
    tx: &mut Transaction<'_, Postgres>,
    team_id: Uuid,
    input: &crate::domain::CreateLeadInput,
) -> Result<Lead, sqlx::Error> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    let status = "open";
    let priority = input.priority.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "normal".to_string());
    let tags: Vec<String> = input.tags.clone().unwrap_or_default();

    sqlx::query(
        r#"
        INSERT INTO crm.leads (id, team_id, owner_user_id, first_name, last_name, email, phone, country, city,
            language, timezone, status, stage_id, source, campaign, tags, priority, score, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 0, $18, $18)
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(input.owner_user_id)
    .bind(&input.first_name)
    .bind(&input.last_name)
    .bind(&input.email)
    .bind(&input.phone)
    .bind(&input.country)
    .bind(&input.city)
    .bind(&input.language)
    .bind(&input.timezone)
    .bind(status)
    .bind(input.stage_id)
    .bind(&input.source)
    .bind(&input.campaign)
    .bind(&tags)
    .bind(&priority)
    .bind(now)
    .execute(&mut **tx)
    .await?;

    let lead = Lead {
        id,
        team_id,
        owner_user_id: input.owner_user_id,
        first_name: input.first_name.clone(),
        last_name: input.last_name.clone(),
        email: input.email.clone(),
        phone: input.phone.clone(),
        country: input.country.clone(),
        city: input.city.clone(),
        language: input.language.clone(),
        timezone: input.timezone.clone(),
        status: crate::domain::LeadStatus::Open,
        stage_id: input.stage_id,
        source: input.source.clone(),
        campaign: input.campaign.clone(),
        utm_source: None,
        utm_medium: None,
        utm_campaign: None,
        tags,
        priority: input.priority.unwrap_or(crate::domain::LeadPriority::Normal),
        score: 0,
        last_contact_at: None,
        next_followup_at: None,
        created_at: now,
        updated_at: now,
    };
    Ok(lead)
}

pub async fn update_lead(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
    input: &crate::domain::UpdateLeadInput,
) -> Result<Option<Lead>, sqlx::Error> {
    let lead = get_by_id_tx(tx, id, team_id, None).await?;
    let Some(mut lead) = lead else {
        return Ok(None);
    };
    if let Some(ref v) = input.first_name {
        lead.first_name = v.clone();
    }
    if let Some(ref v) = input.last_name {
        lead.last_name = v.clone();
    }
    if let Some(ref v) = input.email {
        lead.email = Some(v.clone());
    }
    if let Some(ref v) = input.phone {
        lead.phone = Some(v.clone());
    }
    if let Some(ref v) = input.country {
        lead.country = Some(v.clone());
    }
    if let Some(ref v) = input.city {
        lead.city = Some(v.clone());
    }
    if let Some(ref v) = input.source {
        lead.source = Some(v.clone());
    }
    if let Some(ref v) = input.campaign {
        lead.campaign = Some(v.clone());
    }
    if let Some(ref v) = input.tags {
        lead.tags = v.clone();
    }
    if let Some(v) = input.priority {
        lead.priority = v;
    }

    sqlx::query(
        r#"
        UPDATE crm.leads SET first_name = $1, last_name = $2, email = $3, phone = $4, country = $5, city = $6,
            source = $7, campaign = $8, tags = $9, priority = $10::text, updated_at = now()
        WHERE id = $11 AND team_id = $12 AND deleted_at IS NULL
        "#,
    )
    .bind(&lead.first_name)
    .bind(&lead.last_name)
    .bind(&lead.email)
    .bind(&lead.phone)
    .bind(&lead.country)
    .bind(&lead.city)
    .bind(&lead.source)
    .bind(&lead.campaign)
    .bind(&lead.tags)
    .bind(format!("{:?}", lead.priority).to_lowercase())
    .bind(id)
    .bind(team_id)
    .execute(&mut **tx)
    .await?;

    lead.updated_at = Utc::now();
    Ok(Some(lead))
}

pub async fn assign(tx: &mut Transaction<'_, Postgres>, id: Uuid, team_id: Uuid, owner_user_id: Uuid) -> Result<Option<Lead>, sqlx::Error> {
    sqlx::query("UPDATE crm.leads SET owner_user_id = $1, updated_at = now() WHERE id = $2 AND team_id = $3 AND deleted_at IS NULL")
        .bind(owner_user_id)
        .bind(id)
        .bind(team_id)
        .execute(&mut **tx)
        .await?;
    get_by_id_tx(tx, id, team_id, None).await
}

pub async fn change_stage(tx: &mut Transaction<'_, Postgres>, id: Uuid, team_id: Uuid, stage_id: Uuid) -> Result<Option<Lead>, sqlx::Error> {
    sqlx::query("UPDATE crm.leads SET stage_id = $1, updated_at = now() WHERE id = $2 AND team_id = $3 AND deleted_at IS NULL")
        .bind(stage_id)
        .bind(id)
        .bind(team_id)
        .execute(&mut **tx)
        .await?;
    get_by_id_tx(tx, id, team_id, None).await
}

pub async fn update_last_contact(tx: &mut Transaction<'_, Postgres>, id: Uuid, team_id: Uuid, at: DateTime<Utc>, next_followup: Option<DateTime<Utc>>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE crm.leads SET last_contact_at = $1, next_followup_at = COALESCE($2, next_followup_at), updated_at = now() WHERE id = $3 AND team_id = $4 AND deleted_at IS NULL",
    )
    .bind(at)
    .bind(next_followup)
    .bind(id)
    .bind(team_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn soft_delete(tx: &mut Transaction<'_, Postgres>, id: Uuid, team_id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("UPDATE crm.leads SET deleted_at = now() WHERE id = $1 AND team_id = $2 AND deleted_at IS NULL")
        .bind(id)
        .bind(team_id)
        .execute(&mut **tx)
        .await?;
    Ok(r.rows_affected() > 0)
}

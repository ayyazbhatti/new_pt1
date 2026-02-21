use crate::domain::*;
use crate::events::LeadCreatedPayload;
use crate::repo::{activity, lead, message, outbox, stage, task, template};
use sqlx::PgPool;
use uuid::Uuid;

pub struct LeadsService {
    pub pool: PgPool,
}

impl LeadsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_leads(
        &self,
        team_id: Uuid,
        query: ListLeadsQuery,
        for_agent: Option<Uuid>,
    ) -> Result<(Vec<Lead>, u64), sqlx::Error> {
        lead::list(&self.pool, team_id, &query, for_agent).await
    }

    pub async fn get_lead(&self, id: Uuid, team_id: Uuid, for_agent: Option<Uuid>) -> Result<Option<Lead>, sqlx::Error> {
        lead::get_by_id(&self.pool, id, team_id, for_agent).await
    }

    pub async fn create_lead(&self, team_id: Uuid, input: CreateLeadInput) -> Result<Lead, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let lead = lead::create(&mut tx, team_id, &input).await?;
        let payload = serde_json::to_value(LeadCreatedPayload {
            lead_id: lead.id,
            team_id: lead.team_id,
            lead: serde_json::to_value(&lead).unwrap_or_default(),
        })
        .unwrap_or_default();
        outbox::insert_outbox(&mut tx, "lead", lead.id, team_id, "leads.created", payload).await?;
        tx.commit().await?;
        Ok(lead)
    }

    pub async fn list_stages(&self, team_id: Uuid) -> Result<Vec<LeadStage>, sqlx::Error> {
        stage::list_by_team(&self.pool, team_id).await
    }

    pub async fn list_activities(&self, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadActivity>, sqlx::Error> {
        activity::list_by_lead(&self.pool, lead_id, team_id).await
    }

    pub async fn list_tasks(&self, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadTask>, sqlx::Error> {
        task::list_by_lead(&self.pool, lead_id, team_id).await
    }

    pub async fn list_messages(&self, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadMessage>, sqlx::Error> {
        message::list_by_lead(&self.pool, lead_id, team_id).await
    }

    pub async fn list_templates(&self, team_id: Uuid) -> Result<Vec<EmailTemplate>, sqlx::Error> {
        template::list_by_team(&self.pool, team_id).await
    }
}

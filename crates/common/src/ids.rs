use uuid::Uuid;

pub type UserId = Uuid;
pub type OrderId = Uuid;
pub type PositionId = Uuid;
pub type SymbolId = Uuid;
pub type LeverageProfileId = Uuid;
pub type TierId = Uuid;

pub fn generate_id() -> Uuid {
    Uuid::new_v4()
}


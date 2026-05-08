use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // ─── Types ────────────────────────────────────────────────────────────────

    /// Oracle data submitted for milestone evaluation.
    /// All fields are encrypted by the client before being passed on-chain.
    pub struct MilestoneInput {
        /// The oracle-reported value (e.g., TVL, price, revenue figure).
        oracle_value: u64,
        /// Threshold the value must meet or exceed for unlock.
        milestone_target: u64,
    }

    /// Admin operation descriptor — encrypted so no single node knows which
    /// operation is being authorized until quorum is formed.
    pub struct AdminOpInput {
        /// SHA-256 hash of the canonical operation descriptor
        /// (e.g. hash("PauseProtocol" || program_id || nonce)).
        op_hash: [u8; 32],
    }

    // ─── Circuit 1: milestone_attestation ────────────────────────────────────

    /// Returns 1 (milestone reached) or 0 (not reached).
    ///
    /// The Haifu withdraw instruction reads this result from the on-chain
    /// callback and conditionally releases total_amount to the recipient.
    ///
    /// Privacy: neither the oracle value nor the target is revealed to any
    /// single Arx node — only the boolean outcome is published.
    #[instruction]
    pub fn milestone_attestation(
        input_ctxt: Enc<Shared, MilestoneInput>,
    ) -> Enc<Shared, u8> {
        // TODO (Week 4): implement MPC comparison logic.
        // Arcis MPC will evaluate oracle_value >= milestone_target inside the
        // encrypted domain. Placeholder returns 0 until logic is added.
        let _input = input_ctxt.to_arcis();
        input_ctxt.owner.from_arcis(0u8)
    }

    // ─── Circuit 2: admin_authorization ──────────────────────────────────────

    /// Threshold-signs an admin operation hash.
    ///
    /// Returns 1 if the quorum of Arx nodes agree on op_hash, 0 otherwise.
    /// Because authority lives in the MXE cluster — not a multisig wallet —
    /// no single party can pause, upgrade, or drain the protocol unilaterally.
    ///
    /// Replaces: 3-of-5 multisig admin wallet.
    #[instruction]
    pub fn admin_authorization(
        op_ctxt: Enc<Shared, AdminOpInput>,
    ) -> Enc<Shared, u8> {
        // TODO (Week 4): call threshold_sign(op_hash, HAIFU_ADMIN_MXE_CLUSTER).
        // Placeholder returns 0 until logic is added.
        let _op = op_ctxt.to_arcis();
        op_ctxt.owner.from_arcis(0u8)
    }
}

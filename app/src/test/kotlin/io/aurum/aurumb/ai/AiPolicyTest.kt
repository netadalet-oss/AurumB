package io.aurum.aurumb.ai

import io.aurum.common.ai.AiAdvisory
import org.junit.Assert.*
import org.junit.Test

class AiPolicyTest {
    @Test
    fun proposalsRemainAdvisoryAndRespectBounds() {
        val missing=AiPolicy.review(AiAdvisory("aurum-ai-advisory/v1","x",emptyList(),null,0.5))
        assertFalse(missing.accepted)

        val dominant=(1..7).associate{"K"+it to if(it==1)0.7 else 0.05}
        val rejected=AiPolicy.review(AiAdvisory("aurum-ai-advisory/v1","x",emptyList(),dominant,0.8))
        assertFalse(rejected.accepted)

        val valid=mapOf(
            "K1" to 0.20,"K2" to 0.18,"K3" to 0.14,"K4" to 0.14,
            "K5" to 0.12,"K6" to 0.12,"K7" to 0.10
        )
        val advisory=AiPolicy.review(AiAdvisory("aurum-ai-advisory/v1","x",emptyList(),valid,0.8))
        assertFalse(advisory.accepted)
        assertEquals(7,advisory.proposedWeights?.size)
        assertTrue(advisory.reasons.any{it.contains("deterministic",ignoreCase=true)})
    }
}

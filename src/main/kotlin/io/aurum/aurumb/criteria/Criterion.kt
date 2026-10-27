package io.aurum.aurumb.criteria

import java.math.BigDecimal

enum class CriterionRole { DECISION, DIAGNOSTIC, RISK_META, LEARNING_META }
data class CriterionSpec(val id:String,val name:String,val purpose:String,val role:CriterionRole,val baseWeight:BigDecimal,val formulaVersion:String)
data class CriterionResult(val criterionId:String,val score:BigDecimal?,val eligible:Boolean,val reason:String?=null)

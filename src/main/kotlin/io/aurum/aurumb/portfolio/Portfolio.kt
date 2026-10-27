package io.aurum.aurumb.portfolio
import java.math.BigDecimal
import java.math.MathContext
import java.time.Instant
private val MC=MathContext.DECIMAL128
data class Position(val symbol:String,val quantity:BigDecimal,val entryPrice:BigDecimal,val openedAt:Instant){init{require(quantity>BigDecimal.ZERO);require(entryPrice>BigDecimal.ZERO)}}
data class Fill(val id:String,val symbol:String,val quantity:BigDecimal,val price:BigDecimal,val fee:BigDecimal,val at:Instant){init{require(price>BigDecimal.ZERO);require(fee>=BigDecimal.ZERO)}}
data class PortfolioSnapshot(val at:Instant,val cash:BigDecimal,val realizedPnl:BigDecimal,val unrealizedPnl:BigDecimal,val equity:BigDecimal,val exposure:BigDecimal)
object PortfolioMath{fun unrealized(p:Position,mark:BigDecimal):BigDecimal{require(mark>BigDecimal.ZERO);return mark.subtract(p.entryPrice,MC).multiply(p.quantity,MC)};fun snapshot(at:Instant,cash:BigDecimal,realized:BigDecimal,positions:List<Position>,marks:Map<String,BigDecimal>):PortfolioSnapshot{val mv=positions.fold(BigDecimal.ZERO){a,p->a+requireNotNull(marks[p.symbol]).multiply(p.quantity,MC)};val un=positions.fold(BigDecimal.ZERO){a,p->a+unrealized(p,requireNotNull(marks[p.symbol]))};val eq=cash.add(mv,MC);val ex=if(eq.signum()>0)mv.divide(eq,MC)else BigDecimal.ZERO;return PortfolioSnapshot(at,cash,realized,un,eq,ex)}}

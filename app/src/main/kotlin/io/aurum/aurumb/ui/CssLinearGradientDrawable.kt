package io.aurum.aurumb.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * Draws a CSS-style linear-gradient with the exact CSS angle convention:
 * 0deg = up, 90deg = right, 180deg = down.
 */
class CssLinearGradientDrawable(
    private val angleDegrees:Float,
    private val colors:IntArray,
    private val positions:FloatArray?=null,
    private val cornerRadiusPx:Float=0f,
    private val strokeWidthPx:Float=0f,
    private val strokeColor:Int=Color.TRANSPARENT,
    private val bottomBorderWidthPx:Float=0f,
    private val bottomBorderColor:Int=Color.TRANSPARENT
):Drawable() {
    private val fillPaint=Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint=Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style=Paint.Style.STROKE
    }
    private val rect=RectF()
    private var drawableAlpha:Int=255

    override fun draw(canvas:Canvas) {
        val b=bounds
        if(b.isEmpty) return
        rect.set(b.left.toFloat(),b.top.toFloat(),b.right.toFloat(),b.bottom.toFloat())

        val rad=Math.toRadians(angleDegrees.toDouble())
        val dx=sin(rad).toFloat()
        val dy=(-cos(rad)).toFloat()
        val cx=rect.centerX()
        val cy=rect.centerY()
        val extent=abs(dx)*rect.width()/2f + abs(dy)*rect.height()/2f
        val x0=cx-dx*extent
        val y0=cy-dy*extent
        val x1=cx+dx*extent
        val y1=cy+dy*extent

        fillPaint.shader=LinearGradient(x0,y0,x1,y1,colors,positions,Shader.TileMode.CLAMP)
        fillPaint.alpha=drawableAlpha
        canvas.drawRoundRect(rect,cornerRadiusPx,cornerRadiusPx,fillPaint)

        if(strokeWidthPx>0f && Color.alpha(strokeColor)>0) {
            strokePaint.shader=null
            strokePaint.color=strokeColor
            strokePaint.strokeWidth=strokeWidthPx
            strokePaint.alpha=drawableAlpha
            val inset=strokeWidthPx/2f
            val sr=RectF(rect.left+inset,rect.top+inset,rect.right-inset,rect.bottom-inset)
            val rr=(cornerRadiusPx-inset).coerceAtLeast(0f)
            canvas.drawRoundRect(sr,rr,rr,strokePaint)
        }
        if(bottomBorderWidthPx>0f && Color.alpha(bottomBorderColor)>0) {
            strokePaint.shader=null
            strokePaint.color=bottomBorderColor
            strokePaint.strokeWidth=bottomBorderWidthPx
            strokePaint.alpha=drawableAlpha
            val y=rect.bottom-bottomBorderWidthPx/2f
            canvas.drawLine(rect.left,y,rect.right,y,strokePaint)
        }
    }

    override fun setAlpha(alpha:Int) {
        drawableAlpha=alpha.coerceIn(0,255)
        invalidateSelf()
    }

    override fun getAlpha():Int=drawableAlpha

    override fun setColorFilter(colorFilter:ColorFilter?) {
        fillPaint.colorFilter=colorFilter
        strokePaint.colorFilter=colorFilter
        invalidateSelf()
    }

    @Deprecated("Deprecated in Android")
    override fun getOpacity():Int=PixelFormat.TRANSLUCENT
}

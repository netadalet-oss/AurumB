package io.aurum.aurumb.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.drawable.Drawable

/** Effective final legacy CSS body background. */
class ReferenceBackgroundDrawable:Drawable() {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var drawableAlpha=255
    override fun draw(canvas:Canvas) {
        val b=bounds; val w=b.width().toFloat(); val h=b.height().toFloat()
        if(w<=0f || h<=0f) return
        paint.alpha=drawableAlpha
        paint.shader=LinearGradient(b.left.toFloat(),b.top.toFloat(),b.left.toFloat(),b.bottom.toFloat(),
            intArrayOf(Color.rgb(0,3,14),Color.rgb(0,1,6),Color.rgb(0,4,15)),
            floatArrayOf(0f,.56f,1f),Shader.TileMode.CLAMP)
        canvas.drawRect(b.left.toFloat(),b.top.toFloat(),b.right.toFloat(),b.bottom.toFloat(),paint)
        fun glow(x:Float,y:Float,stop:Float,color:Int){
            val cx=b.left+w*x; val cy=b.top+h*y
            fun d(px:Float,py:Float)=Math.hypot((cx-px).toDouble(),(cy-py).toDouble()).toFloat()
            val radius=kotlin.math.max(kotlin.math.max(d(b.left.toFloat(),b.top.toFloat()),d(b.right.toFloat(),b.top.toFloat())),kotlin.math.max(d(b.left.toFloat(),b.bottom.toFloat()),d(b.right.toFloat(),b.bottom.toFloat()))).coerceAtLeast(1f)
            paint.shader=RadialGradient(cx,cy,radius,intArrayOf(color,Color.TRANSPARENT,Color.TRANSPARENT),floatArrayOf(0f,stop,1f),Shader.TileMode.CLAMP)
            canvas.drawRect(b.left.toFloat(),b.top.toFloat(),b.right.toFloat(),b.bottom.toFloat(),paint)
        }
        glow(.90f,.22f,.34f,Color.argb(28,5,16,43))
        glow(.16f,-.08f,.31f,Color.argb(41,8,23,58))
        paint.shader=null
    }
    override fun setAlpha(alpha:Int){drawableAlpha=alpha.coerceIn(0,255);invalidateSelf()}
    override fun setColorFilter(colorFilter:ColorFilter?){paint.colorFilter=colorFilter;invalidateSelf()}
    @Deprecated("Deprecated in Android") override fun getOpacity():Int=PixelFormat.OPAQUE
}

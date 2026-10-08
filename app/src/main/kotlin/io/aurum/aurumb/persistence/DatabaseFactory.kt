package io.aurum.aurumb.persistence

import android.content.Context
import androidx.room.Room

object DatabaseFactory {
    @Volatile private var instance:AurumDatabase?=null

    fun get(context:Context):AurumDatabase =
        instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AurumDatabase::class.java,
                "aurumb.db"
            ).addMigrations(AurumDatabase.MIGRATION_1_2,AurumDatabase.MIGRATION_2_3,AurumDatabase.MIGRATION_3_4,AurumDatabase.MIGRATION_4_5,AurumDatabase.MIGRATION_5_6,AurumDatabase.MIGRATION_6_7,AurumDatabase.MIGRATION_7_8,AurumDatabase.MIGRATION_8_9,AurumDatabase.MIGRATION_9_10,AurumDatabase.MIGRATION_10_11,AurumDatabase.MIGRATION_11_12,AurumDatabase.MIGRATION_12_13,AurumDatabase.MIGRATION_13_14,AurumDatabase.MIGRATION_14_15,AurumDatabase.MIGRATION_15_16,AurumDatabase.MIGRATION_16_17,AurumDatabase.MIGRATION_17_18,AurumDatabase.MIGRATION_18_19,AurumDatabase.MIGRATION_19_20,AurumDatabase.MIGRATION_20_21)
             .build()
             .also { instance=it }
        }
}

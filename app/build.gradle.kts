import java.security.MessageDigest

plugins { id("com.android.application"); kotlin("android"); kotlin("kapt") }

val releaseKeystorePath = providers.environmentVariable("AURUM_RELEASE_KEYSTORE")
val releaseStorePassword = providers.environmentVariable("AURUM_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = providers.environmentVariable("AURUM_RELEASE_KEY_ALIAS")
val releaseKeyPassword = providers.environmentVariable("AURUM_RELEASE_KEY_PASSWORD")
val releaseSigningConfigured = listOf(
    releaseKeystorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { it.isPresent }

android {
    namespace = "io.aurum.aurumb"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.aurum.next.aurumb"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.3-cleanroom-stability"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("release") {
            if (releaseSigningConfigured) {
                storeFile = file(releaseKeystorePath.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }
    buildTypes {
        debug { isDebuggable = true }
        release {
            isDebuggable = false
            isMinifyEnabled = false
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
kapt {
    arguments { arg("room.schemaLocation", "$projectDir/schemas") }
}

tasks.register("verifyReleaseSigning") {
    doLast {
        check(releaseSigningConfigured) {
            "Release signing is not configured. Provide AURUM_RELEASE_KEYSTORE, AURUM_RELEASE_STORE_PASSWORD, AURUM_RELEASE_KEY_ALIAS and AURUM_RELEASE_KEY_PASSWORD."
        }
        val keystore = file(releaseKeystorePath.get())
        check(keystore.isFile) { "Release keystore file does not exist." }
    }
}

tasks.register("releaseChecksums") {
    dependsOn("assembleRelease", "bundleRelease")
    doLast {
        val artifacts = fileTree(layout.buildDirectory.dir("outputs")).matching {
            include("**/*.apk", "**/*.aab")
        }.files.sortedBy { it.absolutePath }
        check(artifacts.isNotEmpty()) { "No release APK/AAB artifacts found." }
        val out = layout.buildDirectory.file("release-checksums.sha256").get().asFile
        out.parentFile.mkdirs()
        out.writeText(
            artifacts.joinToString(separator = System.lineSeparator(), postfix = System.lineSeparator()) { artifact ->
                val digest = MessageDigest.getInstance("SHA-256").digest(artifact.readBytes())
                    .joinToString("") { "%02x".format(it) }
                digest + "  " + artifact.relativeTo(projectDir).path
            }
        )
    }
}

tasks.register("packageVerifiedRelease") {
    dependsOn("verifyReleaseSigning", "releaseChecksums")
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jsoup:jsoup:1.18.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.sqlite:sqlite-framework:2.4.0")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
}

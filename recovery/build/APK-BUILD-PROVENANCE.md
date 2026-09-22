# Build provenance recovered from APK

This file records build facts embedded in the supplied APK. It is evidence, not a guessed Gradle project.

- Android Gradle Plugin: **8.7.3**
- APK app metadata format: **1.1**

Observed packaged AndroidX versions include:
- activity 1.7.0
- appcompat 1.7.0
- core-ktx 1.15.0
- core 1.15.0
- fragment 1.5.4
- profileinstaller 1.3.1
- savedstate 1.2.1
- tracing 1.2.0
- webkit 1.12.1

These values come from `META-INF/com/android/build/gradle/app-metadata.properties` and packaged `META-INF/androidx*.version` files.

Do not infer an exact original `build.gradle(.kts)` solely from these values; the APK does not preserve the complete original Gradle script.

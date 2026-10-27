plugins { kotlin("jvm") }
kotlin {
    jvmToolchain(17)
    sourceSets {
        main { kotlin.srcDir("../src/main/kotlin") }
        test { kotlin.srcDir("../src/test/kotlin") }
    }
}
tasks.register<JavaExec>("domainChecks") {
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set("io.aurum.aurumb.DomainChecksKt")
}
tasks.named("check") { dependsOn("domainChecks") }

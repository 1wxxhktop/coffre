import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Clé de signature fixe des APK publiés (bêtas et releases). Elle vient des
// secrets GitHub (scripts/setup-android-key.sh) : la même clé signe chaque
// version, ce qui permet d’installer une mise à jour par-dessus la précédente
// sans désinstaller l’application ni perdre son coffre local.
val coffreKeystore: String? = System.getenv("COFFRE_ANDROID_KEYSTORE")

android {
    compileSdk = 37
    namespace = "app.coffre.desktop"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.coffre.desktop"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (coffreKeystore != null) {
            create("coffre") {
                storeFile = file(coffreKeystore)
                storeType = "pkcs12"
                storePassword = System.getenv("COFFRE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("COFFRE_ANDROID_KEY_ALIAS") ?: "coffre"
                keyPassword = System.getenv("COFFRE_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Sans clé fixe, l’APK release reste non signé (builds de forks).
            signingConfigs.findByName("coffre")?.let { signingConfig = it }
            // Réduction du code désactivée : les règles ProGuard du projet sont
            // vides et l’APK ne peut pas être testé sur appareil en CI. Mieux
            // vaut un APK un peu plus gros qu’une classe utilisée par la
            // WebView ou JNI retirée par erreur.
            optimization {
               enable = false
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.biometric:biometric:1.1.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))

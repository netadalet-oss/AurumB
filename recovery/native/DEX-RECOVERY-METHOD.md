# Native DEX recovery method

JADX is not a prerequisite for this recovery.

The supplied APK's `classes3.dex` is the authoritative compiled representation of the native application layer. Recovery proceeds directly from DEX structures:

1. parse DEX header and string/type/prototype/field/method/class tables;
2. select `Lcom/aurum/bistterminal8/*;`;
3. decode each class_data_item and code_item;
4. disassemble Dalvik instructions and exception/branch targets;
5. recover constants, Android API calls, bridge command strings, fields and method descriptors;
6. reconstruct readable Java/Kotlin-equivalent source;
7. mark reconstructed source `RECONSTRUCTED_FROM_DEX`;
8. compare the reconstructed bridge surface against the APK-exact JavaScript assets.

This avoids importing similarly named external projects and does not claim decompiled syntax is the original Kotlin text.

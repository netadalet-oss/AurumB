package io.aurum.aurumb.exchange

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.persistence.DataMutationCoordinator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

enum class ExchangeFormat(val extension:String,val mime:String) {
    JSON("json","application/json"),
    CSV("csv","text/csv"),
    TXT("txt","text/plain"),
    XLSX("xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    PDF("pdf","application/pdf")
}

data class ImportReport(val tables:Int,val rows:Int,val replaced:Boolean)

class DataExchangeService(private val context:Context) {
    private val app=context.applicationContext
    private val database=DatabaseFactory.get(app)
    private val product="B"

    suspend fun exportAll(treeUri:Uri,format:ExchangeFormat):Uri=
        exportSelected(treeUri,format,null,false).single()

    suspend fun availableTables():List<String> = withContext(Dispatchers.IO) {
        userTables(database.openHelper.readableDatabase)
    }

    suspend fun exportSelected(
        treeUri:Uri,
        format:ExchangeFormat,
        selectedTables:Set<String>?,
        separateFiles:Boolean
    ):List<Uri> = DataMutationCoordinator.serialized {
        withContext(Dispatchers.IO) {
            val tree=DocumentFile.fromTreeUri(app,treeUri)
                ?: throw IllegalArgumentException("EXPORT_FOLDER_UNAVAILABLE")
            val allowed=userTables(database.openHelper.readableDatabase).toSet()
            if(selectedTables!=null) require(selectedTables.isNotEmpty()){"EXPORT_NO_TABLE_SELECTED"}
            val chosen=selectedTables ?: allowed
            require(chosen.all{it in allowed}){"EXPORT_UNKNOWN_TABLE"}
            val stamp=Instant.now().toString().replace(":","-")
            val groups=if(separateFiles) chosen.sorted().map{setOf(it)} else listOf(chosen)
            groups.map { group ->
                val payload=snapshotJson(group)
                val suffix=if(separateFiles) "_"+group.single().replace(Regex("[^A-Za-z0-9._-]"),"_") else ""
                val fileName="Aurum_"+product+"_"+stamp+suffix+"."+format.extension
                val file=tree.createFile(format.mime,fileName)
                    ?: throw IllegalStateException("EXPORT_FILE_CREATE_FAILED")
                val bytes=encode(payload,format)
                app.contentResolver.openOutputStream(file.uri,"w")?.use{it.write(bytes)}
                    ?: throw IllegalStateException("EXPORT_STREAM_UNAVAILABLE")
                file.uri
            }
        }
    }

    suspend fun importFile(uri:Uri,replaceAll:Boolean=false):ImportReport =
        DataMutationCoordinator.serialized {
            withContext(Dispatchers.IO) {
                val bytes=app.contentResolver.openInputStream(uri)?.use{it.readBytes()}
                    ?: throw IllegalArgumentException("IMPORT_STREAM_UNAVAILABLE")
                val payload=decode(bytes,uri)
                restorePayload(payload,replaceAll)
            }
        }

    fun snapshotJson(selectedTables:Set<String>?=null):JSONObject {
        val db=database.openHelper.readableDatabase
        val available=userTables(db)
        if(selectedTables!=null) require(selectedTables.isNotEmpty()){"EXPORT_NO_TABLE_SELECTED"}
        val chosen=selectedTables ?: available.toSet()
        require(chosen.all{it in available}){"EXPORT_UNKNOWN_TABLE"}
        val root=JSONObject()
            .put("format","AURUM_DATA_EXCHANGE_V1")
            .put("product",product)
            .put("generatedAtUtc",Instant.now().toString())
            .put("integrityVersion",1)
            .put("sqliteUserVersion",userVersion(db))
        val tables=JSONObject()
        for(table in available.filter{it in chosen}) {
            val rows=JSONArray()
            db.query("SELECT * FROM "+quoteIdentifier(table)).use { cursor ->
                while(cursor.moveToNext()) {
                    val row=JSONObject()
                    cursor.columnNames.forEachIndexed { index,name ->
                        row.put(name,encodeCell(cursor,index))
                    }
                    rows.put(row)
                }
            }
            tables.put(table,rows)
        }
        root.put("tables",tables)
        root.put("payloadSha256",sha256(canonicalJson(root).toByteArray(StandardCharsets.UTF_8)))
        return root
    }

    fun restorePayload(payload:JSONObject,replaceAll:Boolean=false):ImportReport {
        val db=database.openHelper.writableDatabase
        validatePayload(payload,replaceAll,db)
        val allowed=userTables(db).toSet()
        val incoming=payload.getJSONObject("tables")
        var tableCount=0
        var rowCount=0
        db.beginTransaction()
        try {
            if(replaceAll) {
                allowed.sortedDescending().forEach { table ->
                    db.execSQL("DELETE FROM "+quoteIdentifier(table))
                }
            }
            val names=incoming.keys()
            while(names.hasNext()) {
                val table=names.next()
                val rows=incoming.getJSONArray(table)
                val columns=tableColumns(db,table)
                for(i in 0 until rows.length()) {
                    val row=rows.getJSONObject(i)
                    val unknown=row.keys().asSequence().filter{it !in columns}.toList()
                    require(unknown.isEmpty()){"IMPORT_UNKNOWN_COLUMNS:"+table+":"+unknown.joinToString(",")}
                    val values=ContentValues()
                    val keys=row.keys()
                    while(keys.hasNext()) {
                        val key=keys.next()
                        putCell(values,key,row.opt(key))
                    }
                    if(values.size()>0) {
                        val result=db.insert(table,SQLiteDatabase.CONFLICT_REPLACE,values)
                        require(result!=-1L){"IMPORT_INSERT_FAILED:"+table+":"+i}
                        rowCount++
                    }
                }
                tableCount++
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return ImportReport(tableCount,rowCount,replaceAll)
    }

    fun validatePayload(
        payload:JSONObject,
        replaceAll:Boolean=false,
        db:androidx.sqlite.db.SupportSQLiteDatabase=database.openHelper.writableDatabase
    ) {
        require(payload.optString("format")=="AURUM_DATA_EXCHANGE_V1"){"IMPORT_FORMAT_UNSUPPORTED"}
        require(payload.optString("product")==product){"IMPORT_PRODUCT_MISMATCH"}
        require(payload.optInt("integrityVersion",-1)==1){"IMPORT_INTEGRITY_VERSION_UNSUPPORTED"}
        val incomingSchema=payload.optInt("sqliteUserVersion",-1)
        val currentSchema=userVersion(db)
        require(incomingSchema in 1..currentSchema){"IMPORT_SCHEMA_VERSION_UNSUPPORTED:"+incomingSchema+"->"+currentSchema}
        val expected=payload.optString("payloadSha256").lowercase()
        require(expected.matches(Regex("[a-f0-9]{64}"))){"IMPORT_CHECKSUM_MISSING"}
        val clone=JSONObject(payload.toString()).apply{remove("payloadSha256")}
        val actual=sha256(canonicalJson(clone).toByteArray(StandardCharsets.UTF_8))
        require(actual==expected){"IMPORT_CHECKSUM_MISMATCH"}
        val allowed=userTables(db).toSet()
        val incoming=payload.getJSONObject("tables").keys().asSequence().toSet()
        require(incoming.all{it in allowed}){"IMPORT_UNKNOWN_TABLE"}
        // A full backup from an older compatible schema may legitimately lack
        // tables introduced by the current app. Current tables are cleared first
        // and compatible incoming tables are restored; newer-schema backups are
        // rejected above before any mutation.
    }

    private fun userTables(db:androidx.sqlite.db.SupportSQLiteDatabase):List<String> {
        val out=mutableListOf<String>()
        db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").use { c ->
            while(c.moveToNext()) {
                val name=c.getString(0)
                if(!name.startsWith("sqlite_") && name!="room_master_table" && name!="import_journal") out+=name
            }
        }
        return out
    }

    private fun tableColumns(
        db:androidx.sqlite.db.SupportSQLiteDatabase,
        table:String
    ):Set<String> {
        val out=linkedSetOf<String>()
        db.query("PRAGMA table_info("+quoteIdentifier(table)+")").use { c ->
            val nameIndex=c.getColumnIndex("name")
            while(c.moveToNext()) if(nameIndex>=0) out+=c.getString(nameIndex)
        }
        return out
    }

    private fun encodeCell(c:Cursor,index:Int):Any = when(c.getType(index)) {
        Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
        Cursor.FIELD_TYPE_INTEGER -> JSONObject().put("_aurum_type","INTEGER").put("value",c.getLong(index))
        Cursor.FIELD_TYPE_FLOAT -> JSONObject().put("_aurum_type","FLOAT").put("value",c.getDouble(index))
        Cursor.FIELD_TYPE_BLOB -> JSONObject().put("_aurum_type","BLOB")
            .put("value",Base64.encodeToString(c.getBlob(index),Base64.NO_WRAP))
        else -> c.getString(index)
    }

    private fun putCell(values:ContentValues,key:String,value:Any?) {
        when {
            value==null || value===JSONObject.NULL -> values.putNull(key)
            value is JSONObject && value.optString("_aurum_type")=="INTEGER" ->
                values.put(key,value.optLong("value"))
            value is JSONObject && value.optString("_aurum_type")=="FLOAT" ->
                values.put(key,value.optDouble("value"))
            value is JSONObject && value.optString("_aurum_type")=="BLOB" ->
                values.put(key,Base64.decode(value.optString("value"),Base64.NO_WRAP))
            else -> values.put(key,value.toString())
        }
    }

    private fun encode(payload:JSONObject,format:ExchangeFormat):ByteArray = when(format) {
        ExchangeFormat.JSON -> payload.toString(2).toByteArray(StandardCharsets.UTF_8)
        ExchangeFormat.CSV -> textWithPayload(payload,",").toByteArray(StandardCharsets.UTF_8)
        ExchangeFormat.TXT -> textWithPayload(payload,"\t").toByteArray(StandardCharsets.UTF_8)
        ExchangeFormat.XLSX -> xlsx(payload)
        ExchangeFormat.PDF -> pdf(payload)
    }

    private fun decode(bytes:ByteArray,uri:Uri):JSONObject {
        val name=DocumentFile.fromSingleUri(app,uri)?.name.orEmpty().lowercase()
        if(name.endsWith(".json")) return JSONObject(String(bytes,StandardCharsets.UTF_8))
        if(name.endsWith(".xlsx") || bytes.take(2).toByteArray().contentEquals(byteArrayOf(0x50,0x4b))) {
            return JSONObject(readZipPayload(bytes))
        }
        val text=String(bytes,StandardCharsets.ISO_8859_1)
        val embedded=extractEmbeddedPayload(text)
        if(embedded!=null) return JSONObject(embedded)
        // Plain text generated by this application always carries the embedded payload.
        throw IllegalArgumentException("IMPORT_PAYLOAD_NOT_FOUND")
    }

    private fun textWithPayload(payload:JSONObject,separator:String):String {
        val sb=StringBuilder()
        sb.append("AURUM ").append(product).append(" EXPORT").append('\n')
        sb.append("generatedAtUtc").append(separator).append(payload.optString("generatedAtUtc")).append('\n')
        val tables=payload.getJSONObject("tables")
        val it=tables.keys()
        while(it.hasNext()) {
            val table=it.next()
            val rows=tables.getJSONArray(table)
            sb.append('\n').append("TABLE").append(separator).append(table)
                .append(separator).append("ROWS").append(separator).append(rows.length()).append('\n')
            for(i in 0 until rows.length()) {
                sb.append(i+1).append(separator)
                    .append(rows.getJSONObject(i).toString().replace("\n"," ")).append('\n')
            }
        }
        sb.append('\n').append(PAYLOAD_BEGIN).append('\n')
        sb.append(Base64.encodeToString(payload.toString().toByteArray(StandardCharsets.UTF_8),Base64.NO_WRAP))
        sb.append('\n').append(PAYLOAD_END).append('\n')
        return sb.toString()
    }

    private fun xlsx(payload:JSONObject):ByteArray {
        val out=ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            fun entry(name:String,text:String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(text.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()
            }
            entry("[Content_Types].xml","""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="json" ContentType="application/json"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>""")
            entry("_rels/.rels","""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""")
            entry("xl/workbook.xml","""<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Aurum Export" sheetId="1" r:id="rId1"/></sheets></workbook>""")
            entry("xl/_rels/workbook.xml.rels","""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>""")
            val rows=mutableListOf<Pair<String,String>>()
            rows+="Product" to product
            rows+="Generated" to payload.optString("generatedAtUtc")
            val tables=payload.getJSONObject("tables")
            val names=tables.keys()
            while(names.hasNext()) {
                val table=names.next()
                rows+=table to (tables.getJSONArray(table).length().toString()+" rows")
            }
            val sheet=StringBuilder("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""")
            rows.forEachIndexed { idx,p ->
                val r=idx+1
                sheet.append("<row r=\"").append(r).append("\"><c r=\"A").append(r)
                    .append("\" t=\"inlineStr\"><is><t>").append(xml(p.first)).append("</t></is></c>")
                    .append("<c r=\"B").append(r)
                    .append("\" t=\"inlineStr\"><is><t>").append(xml(p.second)).append("</t></is></c></row>")
            }
            sheet.append("</sheetData></worksheet>")
            entry("xl/worksheets/sheet1.xml",sheet.toString())
            entry("xl/aurum_payload.json",payload.toString())
        }
        return out.toByteArray()
    }

    private fun readZipPayload(bytes:ByteArray):String {
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while(true) {
                val e=zip.nextEntry ?: break
                if(e.name=="xl/aurum_payload.json") return String(zip.readBytes(),StandardCharsets.UTF_8)
            }
        }
        throw IllegalArgumentException("XLSX_AURUM_PAYLOAD_MISSING")
    }

    private fun pdf(payload:JSONObject):ByteArray {
        val doc=PdfDocument()
        val paint=Paint().apply {
            textSize=8f
            typeface=Typeface.MONOSPACE
        }
        val lines=mutableListOf<String>()
        lines+="AURUM "+product+" FULL DATA EXPORT"
        lines+="Generated: "+payload.optString("generatedAtUtc")
        val tables=payload.getJSONObject("tables")
        val names=tables.keys()
        while(names.hasNext()) {
            val table=names.next()
            val rows=tables.getJSONArray(table)
            lines+=""
            lines+="TABLE "+table+" ("+rows.length()+" rows)"
            for(i in 0 until rows.length()) lines+=(i+1).toString()+" "+rows.getJSONObject(i).toString()
        }
        val perPage=58
        var pageNo=1
        lines.chunked(perPage).forEach { chunk ->
            val info=PdfDocument.PageInfo.Builder(595,842,pageNo++).create()
            val page=doc.startPage(info)
            var y=24f
            for(line in chunk) {
                page.canvas.drawText(line.take(150),18f,y,paint)
                y+=13f
            }
            doc.finishPage(page)
        }
        val out=ByteArrayOutputStream()
        doc.writeTo(out)
        doc.close()
        out.write(("\n"+PAYLOAD_BEGIN+"\n").toByteArray(StandardCharsets.ISO_8859_1))
        out.write(Base64.encode(payload.toString().toByteArray(StandardCharsets.UTF_8),Base64.NO_WRAP))
        out.write(("\n"+PAYLOAD_END+"\n").toByteArray(StandardCharsets.ISO_8859_1))
        return out.toByteArray()
    }

    private fun extractEmbeddedPayload(text:String):String? {
        val a=text.indexOf(PAYLOAD_BEGIN)
        val b=text.indexOf(PAYLOAD_END,a+PAYLOAD_BEGIN.length)
        if(a<0 || b<0) return null
        val raw=text.substring(a+PAYLOAD_BEGIN.length,b).trim()
        return String(Base64.decode(raw,Base64.DEFAULT),StandardCharsets.UTF_8)
    }

    private fun userVersion(db:androidx.sqlite.db.SupportSQLiteDatabase):Int =
        db.query("PRAGMA user_version").use { c -> if(c.moveToFirst()) c.getInt(0) else -1 }

    private fun canonicalJson(value:Any?):String = when(value) {
        null,JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().sorted().joinToString(prefix="{",postfix="}",separator=",") { key ->
            JSONObject.quote(key)+":"+canonicalJson(value.opt(key))
        }
        is JSONArray -> (0 until value.length()).joinToString(prefix="[",postfix="]",separator=",") { i ->
            canonicalJson(value.opt(i))
        }
        is String -> JSONObject.quote(value)
        is Number,is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun sha256(bytes:ByteArray):String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}

    private fun xml(v:String)=v.replace("&","&amp;").replace("<","&lt;")
        .replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;")

    private fun quoteIdentifier(v:String):String="\""+v.replace("\"","\"\"")+"\""

    companion object {
        private const val PAYLOAD_BEGIN="%AURUM_PAYLOAD_BASE64_BEGIN%"
        private const val PAYLOAD_END="%AURUM_PAYLOAD_BASE64_END%"
    }
}

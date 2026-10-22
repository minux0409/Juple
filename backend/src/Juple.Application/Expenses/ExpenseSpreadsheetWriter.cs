using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using Juple.Domain.Expenses;

namespace Juple.Application.Expenses;

/// <summary>No new library. Untrusted Excel cells are inline strings, never formulas; currencies are never summed together.</summary>
public static class ExpenseSpreadsheetWriter
{
    private static readonly string[] Headers = ["Id", "Name", "Provider", "Category", "OccurredOn", "PaidOn", "Status", "Kind", "Source", "Currency", "Net", "Tax", "Gross", "ConvertedCurrency", "ExchangeRate", "ExchangeRateOn", "ConvertedGross", "PaymentMethod", "InvoiceReference", "Memo", "EvidenceFiles", "ReconciledByExpenseId", "NoLongerReported", "Environment", "SubscriptionId", "ResourceGroup", "ServiceName", "RawImportedAmount", "CustomCategory", "PeriodFrom", "PeriodThrough", "ExchangeRateSource"];
    private static string[] Cells(ExpenseRow row)
    {
        var e = row.Expense;
        static string Number(decimal? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "";
        return [e.Id.ToString(CultureInfo.InvariantCulture), e.Name, e.Provider, e.Category.ToString(), e.OccurredOn.ToString("yyyy-MM-dd"), e.PaidOn?.ToString("yyyy-MM-dd") ?? "",
            e.Status.ToString(), e.Kind.ToString(), e.Source.ToString(), e.Currency, Number(e.NetAmount), Number(e.TaxAmount), Number(e.GrossAmount),
            e.ConvertedCurrency ?? "", Number(e.ExchangeRate), e.ExchangeRateOn?.ToString("yyyy-MM-dd") ?? "", Number(e.ExchangeRate is { } rate ? e.GrossAmount * rate : null),
            e.PaymentMethod, e.InvoiceReference ?? "", e.Memo ?? "", string.Join("; ", row.Attachments.Select(a => $"{a.Id}:{a.FileName}")),
            e.ReconciledByExpenseId?.ToString(CultureInfo.InvariantCulture) ?? "", e.NoLongerReported.ToString(), e.Environment ?? "", e.SubscriptionId ?? "", e.ResourceGroup ?? "", e.ServiceName ?? "", e.RawImportedAmount ?? "",
            e.CustomCategory ?? "", e.PeriodFrom?.ToString("yyyy-MM-dd") ?? "", e.PeriodThrough?.ToString("yyyy-MM-dd") ?? "", e.ExchangeRateSource ?? ""];
    }
    public static byte[] Csv(IReadOnlyList<ExpenseRow> rows)
    {
        var result = new StringBuilder("\uFEFF");
        foreach (var row in new[] { Headers }.Concat(rows.Select(Cells)))
            result.AppendJoin(',', row.Select(Juple.Application.DataExport.DataExportArchiveWriter.Csv)).Append("\r\n");
        return Encoding.UTF8.GetBytes(result.ToString());
    }
    public static byte[] Excel(IReadOnlyList<ExpenseRow> rows)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            Write(zip, "[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>");
            Write(zip, "_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Write(zip, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Expenses\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Write(zip, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>");
            using var sheet = zip.CreateEntry("xl/worksheets/sheet1.xml").Open();
            using var xml = XmlWriter.Create(sheet, new XmlWriterSettings { Encoding = new UTF8Encoding(false), CloseOutput = false, CheckCharacters = true });
            const string ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            xml.WriteStartElement("worksheet", ns); xml.WriteStartElement("sheetData", ns);
            foreach (var values in new[] { Headers }.Concat(rows.Select(Cells)))
            {
                xml.WriteStartElement("row", ns);
                for (var index = 0; index < values.Length; index++)
                {
                    var text = values[index];
                    xml.WriteStartElement("c", ns);
                    // Numeric amounts within Excel's 15 significant digits stay numeric; preserve more precise originals as text.
                    var numeric = index is 0 or 10 or 11 or 12 or 14 or 16 && decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out _) && text.Count(char.IsDigit) <= 15;
                    xml.WriteAttributeString("t", numeric ? "n" : "inlineStr");
                    if (numeric) xml.WriteElementString("v", ns, text);
                    else { xml.WriteStartElement("is", ns); xml.WriteStartElement("t", ns); xml.WriteAttributeString("xml", "space", "http://www.w3.org/XML/1998/namespace", "preserve"); xml.WriteString(CleanXml(text)); xml.WriteEndElement(); xml.WriteEndElement(); }
                    xml.WriteEndElement();
                }
                xml.WriteEndElement();
            }
            xml.WriteEndElement(); xml.WriteEndElement();
        }
        return output.ToArray();
    }
    private static string CleanXml(string text) => string.Concat(text.EnumerateRunes().Where(rune => rune.Value is 9 or 10 or 13 or >= 0x20 and <= 0xD7FF or >= 0xE000 and <= 0xFFFD or >= 0x10000 and <= 0x10FFFF));
    private static void Write(ZipArchive zip, string path, string content) { using var writer = new StreamWriter(zip.CreateEntry(path).Open(), new UTF8Encoding(false)); writer.Write(content); }
}

<#
.SYNOPSIS
    Processes invoice emails in Outlook - files sent copies and acceptance replies
    to customer-specific folders, and marks invoices as received in TimeTracker.

.DESCRIPTION
    Connects to Outlook via COM, scans the inbox for:
    1. Sent invoice copies (subject: "Invoice #XXXX from ...") - moves to customer's
       outlook_invoice_sent_folder
    2. Acceptance replies (subject contains "Re: Invoice #XXXX" with success/accepted/
       processed keywords) - marks invoice received in TimeTracker API, then moves to
       customer's outlook_invoice_received_folder

.PARAMETER ServerUrl
    TimeTracker server URL. Default: http://localhost:3000

.PARAMETER Email
    Admin email for TimeTracker login.

.PARAMETER Password
    Admin password for TimeTracker login.

.PARAMETER DryRun
    If set, shows what would happen without moving emails or marking invoices.

.PARAMETER MaxEmails
    Maximum emails to process per run. Default: 50

.EXAMPLE
    .\Process-InvoiceEmails.ps1 -Email admin@company.com -Password secret
    .\Process-InvoiceEmails.ps1 -Email admin@company.com -Password secret -DryRun
#>

param(
    [string]$ServerUrl = "http://localhost:3000",
    [Parameter(Mandatory=$true)][string]$Email,
    [Parameter(Mandatory=$true)][string]$Password,
    [switch]$DryRun,
    [int]$MaxEmails = 50
)

$ErrorActionPreference = "Stop"

# -- Auth ----------------------------------------------------------------------

function Get-AuthToken {
    param([string]$Server, [string]$UserEmail, [string]$UserPassword)
    $body = @{ email = $UserEmail; password = $UserPassword } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$Server/api/login" -Method Post -Body $body -ContentType "application/json"
    return $response.token
}

function Invoke-Api {
    param([string]$Endpoint, [string]$Method = "GET", [string]$Token)
    $headers = @{ Authorization = "Bearer $Token" }
    try {
        return Invoke-RestMethod -Uri "$ServerUrl$Endpoint" -Method $Method -Headers $headers -ContentType "application/json"
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 404) { return $null }
        throw
    }
}

# -- Outlook COM ---------------------------------------------------------------

function Get-OutlookNamespace {
    $outlook = New-Object -ComObject Outlook.Application
    return $outlook.GetNamespace("MAPI")
}

function Find-OutlookFolder {
    param($Namespace, [string]$FolderPath)
    $parts = $FolderPath -split '\\'
    $folder = $null

    foreach ($store in $Namespace.Stores) {
        $root = $store.GetRootFolder()
        if ($root.Name -eq $parts[0]) {
            $folder = $root
            break
        }
        foreach ($sub in $root.Folders) {
            if ($sub.Name -eq $parts[0]) {
                $folder = $sub
                break
            }
        }
        if ($folder) { break }
    }

    if (-not $folder) {
        # Try as subfolder of root folders
        foreach ($store in $Namespace.Stores) {
            $root = $store.GetRootFolder()
            try {
                $candidate = $root.Folders.Item($parts[0])
                if ($candidate) { $folder = $candidate; break }
            } catch {}
        }
    }

    if (-not $folder) { return $null }

    for ($i = 1; $i -lt $parts.Count; $i++) {
        try {
            $folder = $folder.Folders.Item($parts[$i])
        } catch {
            return $null
        }
    }
    return $folder
}

function Get-InboxFolder {
    param($Namespace)
    # olFolderInbox = 6
    return $Namespace.GetDefaultFolder(6)
}

# -- Email Parsing -------------------------------------------------------------

function Get-InvoiceNumberFromSubject {
    param([string]$Subject)
    if ($Subject -match 'Invoice\s*#(\d+)') {
        return $Matches[1]
    }
    return $null
}

function Test-AcceptanceReply {
    param($MailItem)
    $subject = $MailItem.Subject
    $body = $MailItem.Body

    $isReply = $subject -match '(?i)(Re:|Fwd:).*Invoice\s*#\d+'
    if (-not $isReply) { return $false }

    $acceptKeywords = @('accepted', 'received', 'processed', 'success', 'approved', 'acknowledged')
    $subjectLower = $subject.ToLower()
    $bodyLower = $body.ToLower()

    foreach ($kw in $acceptKeywords) {
        if ($subjectLower.Contains($kw) -or $bodyLower.Contains($kw)) {
            return $true
        }
    }
    return $false
}

function Test-SentInvoiceCopy {
    param($MailItem)
    $subject = $MailItem.Subject
    return ($subject -match '^Invoice\s*#\d+\s+from\s+')
}

# -- Main ----------------------------------------------------------------------

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  TimeTracker Invoice Email Processor" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  ** DRY RUN - no changes will be made **" -ForegroundColor Yellow }
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# Authenticate
Write-Host "Authenticating with TimeTracker..." -ForegroundColor Gray
$token = Get-AuthToken -Server $ServerUrl -UserEmail $Email -UserPassword $Password
Write-Host "  Authenticated." -ForegroundColor Green

# Connect to Outlook
Write-Host "Connecting to Outlook..." -ForegroundColor Gray
$namespace = Get-OutlookNamespace
$inbox = Get-InboxFolder -Namespace $namespace
Write-Host "  Connected. Inbox has $($inbox.Items.Count) items." -ForegroundColor Green
Write-Host ""

$stats = @{ invoicesMoved = 0; repliesMoved = 0; markedReceived = 0; skipped = 0; errors = 0 }

# Collect matching emails first (iterating while moving can skip items)
$invoiceCopies = @()
$acceptanceReplies = @()

Write-Host "Scanning inbox for invoice emails..." -ForegroundColor Gray
$count = 0
foreach ($item in $inbox.Items) {
    if ($count -ge $MaxEmails) { break }
    if ($item.Class -ne 43) { continue } # olMail = 43

    $invoiceNum = Get-InvoiceNumberFromSubject -Subject $item.Subject
    if (-not $invoiceNum) { continue }

    $count++
    if (Test-AcceptanceReply -MailItem $item) {
        $acceptanceReplies += @{ Item = $item; InvoiceNumber = $invoiceNum }
    } elseif (Test-SentInvoiceCopy -MailItem $item) {
        $invoiceCopies += @{ Item = $item; InvoiceNumber = $invoiceNum }
    }
}

Write-Host "  Found $($invoiceCopies.Count) sent invoice copies" -ForegroundColor White
Write-Host "  Found $($acceptanceReplies.Count) acceptance replies" -ForegroundColor White
Write-Host ""

# Process acceptance replies (mark received + move)
if ($acceptanceReplies.Count -gt 0) {
    Write-Host "-- Processing Acceptance Replies -------------------------" -ForegroundColor Cyan
    foreach ($entry in $acceptanceReplies) {
        $invNum = $entry.InvoiceNumber
        $mail = $entry.Item
        Write-Host "  Invoice #$invNum - $($mail.Subject)" -ForegroundColor White

        $invoice = Invoke-Api -Endpoint "/api/invoices/by-number/$invNum" -Token $token
        if (-not $invoice) {
            Write-Host "    SKIP: Invoice #$invNum not found in TimeTracker" -ForegroundColor Yellow
            $stats.skipped++
            continue
        }

        $folderPath = $invoice.outlook_invoice_received_folder
        if (-not $folderPath) {
            Write-Host "    SKIP: No received folder configured for $($invoice.customer_name)" -ForegroundColor Yellow
            $stats.skipped++
            continue
        }

        # Mark as received if not already
        if (-not $invoice.received_at) {
            if ($DryRun) {
                Write-Host "    [DRY RUN] Would mark invoice #$invNum as received" -ForegroundColor Yellow
            } else {
                Invoke-Api -Endpoint "/api/invoices/$($invoice.id)/received" -Method "PUT" -Token $token
                Write-Host "    Marked invoice #$invNum as received" -ForegroundColor Green
            }
            $stats.markedReceived++
        } else {
            Write-Host "    Invoice #$invNum already marked received" -ForegroundColor Gray
        }

        # Move email
        $targetFolder = Find-OutlookFolder -Namespace $namespace -FolderPath $folderPath
        if (-not $targetFolder) {
            Write-Host "    ERROR: Folder not found: $folderPath" -ForegroundColor Red
            $stats.errors++
            continue
        }

        if ($DryRun) {
            Write-Host "    [DRY RUN] Would move to: $folderPath" -ForegroundColor Yellow
        } else {
            $mail.UnRead = $false
            $mail.Move($targetFolder) | Out-Null
            Write-Host "    Moved to: $folderPath" -ForegroundColor Green
        }
        $stats.repliesMoved++
    }
    Write-Host ""
}

# Process sent invoice copies (move only)
if ($invoiceCopies.Count -gt 0) {
    Write-Host "-- Processing Sent Invoice Copies ------------------------" -ForegroundColor Cyan
    foreach ($entry in $invoiceCopies) {
        $invNum = $entry.InvoiceNumber
        $mail = $entry.Item
        Write-Host "  Invoice #$invNum - $($mail.Subject)" -ForegroundColor White

        $invoice = Invoke-Api -Endpoint "/api/invoices/by-number/$invNum" -Token $token
        if (-not $invoice) {
            Write-Host "    SKIP: Invoice #$invNum not found in TimeTracker" -ForegroundColor Yellow
            $stats.skipped++
            continue
        }

        $folderPath = $invoice.outlook_invoice_sent_folder
        if (-not $folderPath) {
            Write-Host "    SKIP: No sent folder configured for $($invoice.customer_name)" -ForegroundColor Yellow
            $stats.skipped++
            continue
        }

        $targetFolder = Find-OutlookFolder -Namespace $namespace -FolderPath $folderPath
        if (-not $targetFolder) {
            Write-Host "    ERROR: Folder not found: $folderPath" -ForegroundColor Red
            $stats.errors++
            continue
        }

        if ($DryRun) {
            Write-Host "    [DRY RUN] Would move to: $folderPath" -ForegroundColor Yellow
        } else {
            $mail.UnRead = $false
            $mail.Move($targetFolder) | Out-Null
            Write-Host "    Moved to: $folderPath" -ForegroundColor Green
        }
        $stats.invoicesMoved++
    }
    Write-Host ""
}

# Summary
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "  Sent copies moved:    $($stats.invoicesMoved)" -ForegroundColor White
Write-Host "  Replies moved:        $($stats.repliesMoved)" -ForegroundColor White
Write-Host "  Invoices received:    $($stats.markedReceived)" -ForegroundColor White
Write-Host "  Skipped:              $($stats.skipped)" -ForegroundColor Yellow
if ($stats.errors -gt 0) { $errColor = "Red" } else { $errColor = "White" }
Write-Host "  Errors:               $($stats.errors)" -ForegroundColor $errColor
Write-Host "===========================================================" -ForegroundColor Cyan

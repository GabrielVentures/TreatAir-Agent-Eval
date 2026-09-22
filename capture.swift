import Foundation
import CoreGraphics
import Vision
import ImageIO
import ScreenCaptureKit

// Read-only window inventory or OCR of a user-specified screenshot.
let args = CommandLine.arguments
if args.count > 1 && args[1] == "permission" {
    print("{\"screenCaptureAllowed\":\(CGPreflightScreenCaptureAccess())}")
} else if args.count > 3 && args[1] == "capture" {
    // Do not request or change privacy permissions automatically.
    guard CGPreflightScreenCaptureAccess() else { fatalError("Screen Recording permission is required") }
    let requested = UInt32(args[2])!
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly:false)
    guard let window=content.windows.first(where:{$0.windowID==requested}),
          (window.owningApplication?.applicationName.lowercased().contains("x-plane") ?? false)
    else { fatalError("Requested X-Plane window not found") }
    let filter=SCContentFilter(desktopIndependentWindow:window)
    let config=SCStreamConfiguration()
    config.width=Int(window.frame.width);config.height=Int(window.frame.height)
    config.showsCursor=false
    let image:CGImage = try await withCheckedThrowingContinuation { continuation in
        SCScreenshotManager.captureImage(contentFilter:filter,configuration:config) { image,error in
            if let image { continuation.resume(returning:image) }
            else { continuation.resume(throwing:error ?? NSError(domain:"Capture",code:1)) }
        }
    }
    let url=URL(fileURLWithPath:args[3]) as CFURL
    guard let output=CGImageDestinationCreateWithURL(url,"public.png" as CFString,1,nil) else {fatalError("Cannot create PNG")}
    CGImageDestinationAddImage(output,image,nil)
    guard CGImageDestinationFinalize(output) else {fatalError("PNG write failed")}
    print("{\"captured\":true}")
} else if args.count == 1 || args[1] == "windows" {
    let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
    let selected = windows.filter { ($0[kCGWindowOwnerName as String] as? String ?? "").lowercased().contains("x-plane") }
    let data = try JSONSerialization.data(withJSONObject:selected,options:[.prettyPrinted,.sortedKeys])
    print(String(data:data,encoding:.utf8)!)
} else {
    let url = URL(fileURLWithPath:args[1])
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(url:url).perform([request])
    let result = (request.results ?? []).compactMap { item -> [String:Any]? in
        guard let candidate=item.topCandidates(1).first else {return nil}
        let b=item.boundingBox
        return ["text":candidate.string,"confidence":candidate.confidence,"box":[b.minX,b.minY,b.width,b.height]]
    }
    print(String(data:try JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
}

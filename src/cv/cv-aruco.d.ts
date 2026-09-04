// Hand-written type shim for the OpenCV.js ArUco module. The
// @techstark/opencv-js package's generated types do not cover `cv.aruco`, so
// we declare the minimal surface ToolTrace needs here. Types are `any`-based
// where the underlying OpenCV.js API is loosely typed (e.g. MatVector
// contents), matching the spec's guidance to keep this shim minimal.
import type { Mat, MatVector } from '@techstark/opencv-js'

export interface aruco_Dictionary {
  generateImageMarker(id: number, sidePixels: number, img: Mat, borderBits: number): void
  /** Frees the underlying WASM-heap object. Must be called explicitly (see src/cv/mats.ts). */
  delete(): void
}

export interface aruco_DetectorParameters {
  cornerRefinementMethod: number
  /** Frees the underlying WASM-heap object. Must be called explicitly (see src/cv/mats.ts). */
  delete(): void
  [key: string]: any
}

export interface aruco_RefineParameters {
  /** Frees the underlying WASM-heap object. Must be called explicitly (see src/cv/mats.ts). */
  delete(): void
}

export interface aruco_ArucoDetector {
  detectMarkers(image: Mat, corners: MatVector, ids: Mat, rejected?: MatVector): void
  /** Frees the underlying WASM-heap object. Must be called explicitly (see src/cv/mats.ts). */
  delete(): void
}

export interface CvAruco {
  getPredefinedDictionary(name: number): aruco_Dictionary
  DICT_4X4_50: number

  aruco_DetectorParameters: {
    new (): aruco_DetectorParameters
  }
  CORNER_REFINE_SUBPIX: number

  aruco_RefineParameters: {
    new (minRepDistance: number, errorCorrectionRate: number, checkAllOrders: boolean): aruco_RefineParameters
  }

  aruco_ArucoDetector: {
    new (
      dictionary: aruco_Dictionary,
      detectorParams: aruco_DetectorParameters,
      refineParams: aruco_RefineParameters,
    ): aruco_ArucoDetector
  }

  findHomography(src: Mat, dst: Mat, method?: number, ransacReprojThreshold?: number): Mat
  RANSAC: number
}

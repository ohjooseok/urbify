/* Urbify 발표 화면용 three.js 묶음: window.THREE_U 로 내보낸다(필요한 것만) */
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
window.THREE_U = {
  REVISION: T.REVISION,
  WebGLRenderer: T.WebGLRenderer, WebGLRenderTarget: T.WebGLRenderTarget, HalfFloatType: T.HalfFloatType,
  Scene: T.Scene, PerspectiveCamera: T.PerspectiveCamera, Group: T.Group, Object3D: T.Object3D,
  BufferGeometry: T.BufferGeometry, BufferAttribute: T.BufferAttribute, Float32BufferAttribute: T.Float32BufferAttribute, Uint32BufferAttribute: T.Uint32BufferAttribute,
  Mesh: T.Mesh, MeshStandardMaterial: T.MeshStandardMaterial, MeshBasicMaterial: T.MeshBasicMaterial, PlaneGeometry: T.PlaneGeometry,
  Color: T.Color, Vector2: T.Vector2, Vector3: T.Vector3, Matrix4: T.Matrix4, Quaternion: T.Quaternion, Euler: T.Euler, Box3: T.Box3, MathUtils: T.MathUtils, Clock: T.Clock,
  DirectionalLight: T.DirectionalLight, HemisphereLight: T.HemisphereLight, AmbientLight: T.AmbientLight,
  PCFShadowMap: T.PCFShadowMap, ACESFilmicToneMapping: T.ACESFilmicToneMapping, AgXToneMapping: T.AgXToneMapping, NeutralToneMapping: T.NeutralToneMapping, NoToneMapping: T.NoToneMapping,
  SRGBColorSpace: T.SRGBColorSpace, PMREMGenerator: T.PMREMGenerator, Fog: T.Fog, DoubleSide: T.DoubleSide, FrontSide: T.FrontSide, BackSide: T.BackSide,
  ShaderMaterial: T.ShaderMaterial, SphereGeometry: T.SphereGeometry, DataArrayTexture: T.DataArrayTexture, RGBAFormat: T.RGBAFormat, UnsignedByteType: T.UnsignedByteType,
  LinearMipmapLinearFilter: T.LinearMipmapLinearFilter, LinearFilter: T.LinearFilter, RepeatWrapping: T.RepeatWrapping, NoColorSpace: T.NoColorSpace,
  OrbitControls, EffectComposer, RenderPass, GTAOPass, OutputPass, LineSegments2, LineSegmentsGeometry, LineMaterial,
};

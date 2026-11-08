"""Raw inputs of the Explore (model comparison) page, with their Google Drive ids and sha256.

All files come from the team's public Drive ("Protein-binding-Phi", shared by dangkhoa20006):
  results/FINAL_INFERENCE_3_MODELS            adabind nuclear / dna / rna residue predictions (+ y_true)
  results/metal_v4_06_final_mlp_esmif_esmfold adabind metal residue predictions (+ label)
  results/SMALL_V3_IMPROVE                    adabind small members (combined with FINAL_DECISION weights)
  results/PER_LIGAND_VS_BASELINES             team DNA/RNA comparison table (used as a check)
  baseline_reproduction_master_v6/repos/bindnode24/dataset   TestSet300 labels (bindEmbed21 / bindNode24)
  baseline_reproduction_master_v6/repos/bind21/data/independent_set   TestSetNew46 labels

Other inputs are already local (see build.py): baselines_2124/ (frozen 21/24 predictions, canonical FASTA,
official metrics), adabind/ (manifest thresholds, CI tables), foundation_models/esmfold_files (ESMFold PDBs).
"""

# relative path under explore_sources/  ->  (drive file id, sha256, size in bytes)
SOURCES: dict[str, tuple[str, str, int]] = {
    "labels/TestSet300/binding_residues_2.5_metal.txt": ("1kqEz5PSJIB8XkpeDdkuVO2FgdsqYaPwH", "0add08cbd367fe5640940349f13fd93f05e25009bddd2c3d77a5cdc2a9d6c24c", 220709),
    "labels/TestSet300/binding_residues_2.5_nuclear.txt": ("190H30daGfwRGEEXtoPpNn1JkeehgsVY1", "b208ccb806e6552bd8ced34e67a88136c6fbcca09ff0c31f33ab538936753868", 100134),
    "labels/TestSet300/binding_residues_2.5_small.txt": ("1CySOzsP1np7TUFJXug8MGi4U0P8dfS3H", "364cf55b221712d3e952c5f1e075bf17c846202af5d873e2a296bd845a18ebce", 949816),
    "labels/TestSet300/all.fasta": ("1RmUKDgGEesov3f3rauuXIZolFxfDAU_u", "342576698104fe1f3f0349f3cd6278cb1b8bbe4b45259178699f5abbc1c5ef31", 248435),
    "labels/TestSetNew46/binding_residues_metal.txt": ("1hcowcEVDUoFQ10QwppgoPjPbZGgweED7", "4756ed9bb861315aa901b4aad3773b7113e4742d65dc25eaec492805d329af1a", 22126),
    "labels/TestSetNew46/binding_residues_nuclear.txt": ("14zSNZ57mcHEMRUe-K6GEy9D2J0GYyCri", "c796f792e4b27604a025e0bdba19cfc5f41ced041fb84642e66e6dd0203d63f5", 10512),
    "labels/TestSetNew46/binding_residues_small.txt": ("13Ik6f4rj15dbXmJ7MPV9OXsTC8tW8CT4", "fbf7f7af24f9b86430032b7e2f110bbc560391b65ba548d7a3f35cdc4e0b4d3b", 121345),
    "labels/TestSetNew46/indep_set.fasta": ("11IN8oULjU2O7liiG6g-tTKbYfBTFcWua", "f6d2025cdd33fb0b0a480041793fb4d805d1868c72adbba7b73e3ab7e0de31b9", 6653),
    "labels/TestSetNew46/indep_set.txt": ("1vsKkD85A5WnGWtPBFZDuqH3X1XwmS6cY", "c3d8301c0d8ee0928a8512d765978dcad9b64d9f139010ae9ecc627807e42e12", 334),
    "adabind/metal/TestSet300.csv.gz": ("1FNLoaB7_Dl3EYyC7gNBGzM1ugjWuwOPw", "55f504efecf8ef5f718def1cb223b5b5bd3656d713ca776b48aae96251869029", 797967),
    "adabind/metal/TestSetNew46.csv.gz": ("1XN8yy3WEjIaJldcO1eduZUrONI77oEsj", "97e0d2105ef3cb74fccb4c875343a8a5969adef8bfc4d42ae874558c1513dd30", 79926),
    "adabind/metal/external_summary.csv": ("1E8RCDbpfZvCPugvwDKMkTrzKofmNfRkq", "fcf68f510c26fec8191f2e62d66453ddc25d42c8377344a147bb9f51e1baf06a", 1621),
    "adabind/small/FINAL_DECISION.json": ("1h4ooSVghIeJNIJHJ7BsCif3G8wB4kPsD", "21e8660db0fccb7a6bd007af1c078480e4e5e24911a5d32591e0d0a3522f5b1b", 1591),
    "adabind/small/CANDIDATES_EXTERNAL.csv": ("1jFSHAbwJlOC6s10rSMdfL4D2tXQ0V1vL", "551d42cef4130067893639f02cc660a9318181c2a831354ae51c50cf000b20ef", 523),
    "adabind/small/V1_s0.npz": ("13KvVBHdPxPh9gM5whtd3COwlwzF6ctIh", "154e3545757595278f1d951b5914f79e963aafccdde110974348350e2d24314b", 1913950),
    "adabind/small/MS_s0.npz": ("1yEiPzjp45XWr6efoptRDdT3OPQzQGlmc", "f207a6222925cc99e58bc0aab795f63cfd6f635d4187a5fcebf4650ef1b8c861", 1913950),
    "adabind/small/V1+ESMIF_EF+PROTT5_s0.npz": ("1yNLbtZDh5ZrZ26noGM8vnTU_23b9mDou", "11a49623588fc4fa9dbde99152694048d83058999d6d9927a2a2c68fdde3310e", 1913950),
    "adabind/small/V1+ESMIF_EF+PROTT5_s1.npz": ("1v1t05W_jwn3p01j1SR4tdGq63XkNJ12J", "df8a51b68661b51a1cee8e7f79f8dee53c2355131de44847478e72b1aa4b1197", 1913950),
    "adabind/small/V1+ESMIF_EF+PROTT5_s2.npz": ("1A_L_aO0n2ipjSvqDGlc-qEcAJ7jBj5gz", "5187e4a93824e1fd15eb84e62c1620d6a32fbe2c7ce7db74ec59dc227ff5521b", 1913950),
    "adabind/small/MS+ESMIF_EF+PROTT5_s0.npz": ("1Auvxd0qXt297YzOw_TYxETyE6YvxZYco", "cf3782c8378ff597e2f46f9103b1c848548538fd39ba0559bc84a51ea84f0b6b", 1913950),
    "adabind/small/MS+ESMIF_EF+PROTT5_s1.npz": ("1PE6hvALOGBufrVg1rn-OTty09Eux-VEI", "c156bffdb14aab09aeda295a23e6c368278b738bea26473ec210c8b47e17bf42", 1913950),
    "adabind/small/MS+ESMIF_EF+PROTT5_s2.npz": ("1pD_zBoYYG7ENm6HTnhQ-ZQH5mFVhaLtA", "4a4a01aafb68c739b894d814914aa4836428dabe8f8679a583ffbe62126129f8", 1913950),
    "adabind/final3/nuclear__TestSet300__residue_predictions.csv.gz": ("1ii4uO6Hm4c5A4PYkaqu-eyvNl845QsiP", "914443f58ada4fc452053ce3b0d1fc6916810998eeecf03b68e37e20328ded74", 804703),
    "adabind/final3/nuclear__TestSetNew46__residue_predictions.csv.gz": ("1bf5045AStcFRWuRN4VbiSswGsvpNn37p", "a3aa121ea4b8111a7def7682bda65aff4c4ac40f3256414c779a6660f2d11c6a", 81367),
    "adabind/final3/dna__TestSet300__residue_predictions.csv.gz": ("1w1Vl-A-3qbF9oNwLWpGqxFBVAxDwakyb", "f045a23c8042b43cfab3928c2c6051887cafaa65724d8f4a2a9d0abca7e1808e", 801855),
    "adabind/final3/dna__TestSetNew46__residue_predictions.csv.gz": ("10N2yusEVSXKM8BtzfvCp1_iJZqbiGVdi", "dee64a5f61679046e4b3e1e8db874193313cefe2ae629a0899809bcc45011a87", 80820),
    "adabind/final3/rna__TestSet300__residue_predictions.csv.gz": ("12gyUjtYrHE8fpTZ0wqlqdYLIb12Y38LT", "e2645f2a6b20da4ce3f89bdd557e93c02230c84670615ed57f2fb651206c2dad", 795914),
    "adabind/final3/rna__TestSetNew46__residue_predictions.csv.gz": ("1anTkq9wp-fOsDqy1EGH-jVaEJJ_8j3Om", "62ac528f46fd03e40848e2f086ca88c04643476d39f56c9a856390d55231a8bc", 80718),
    "adabind/final3/SUMMARY.csv": ("1RUP6-Y5WGCXSSBl7W6K11EVTy-bYrn1h", "9c72cea32ab9cdba2171b4be149ce93376aba0b7619760303f07b5dc54a193c8", 1083),
    "adabind/final3/FINAL_MODELS.json": ("1tEnlKmsfV96M529QPDzNZqde5NvBNGoq", "69c92f990e603a6df02c97b4f4930882a81dcc8056fc6ebee9b30fc2fae4e82b", 966),
    "comparison/per_ligand_table.csv": ("1HHI3G84iwSXzLVZ_4ECco4s7YFbyb6WQ", "e9ea3c36a5dd84231dc4ce86091c07289a773561f99783c14089fefd764f8258", 1585),
}

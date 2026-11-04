import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { ProteinStructure, BindingResidue } from '../models/protein-structure.model';
import { Protein } from '../models/protein.model';
import { PredictionMethod } from '../models/method.model';

@Injectable({
  providedIn: 'root'
})
export class ProteinStructureService {
  
  // Mock mapping of protein IDs to PDB files
  private structureMapping: Record<string, string> = {
    'PROT_0000': 'example-protein.pdb',
    'PROT_0001': 'example-protein.pdb',
    'PROT_0002': 'example-protein.pdb'
  };

  /**
   * Get protein structure including 3D coordinates
   */
  getProteinStructure(proteinId: string): Observable<ProteinStructure> {
    const pdbFile = this.structureMapping[proteinId] || 'example-protein.pdb';
    
    return this.loadPDBFile(pdbFile).pipe(
      map(pdbData => ({
        proteinId,
        pdbId: this.extractPDBId(pdbData),
        pdbData,
        chains: this.extractChains(pdbData),
        residues: this.extractResidues(pdbData),
        bindingResidues: [],
        ligands: this.extractLigands(pdbData),
        metalIons: this.extractMetalIons(pdbData)
      })),
      delay(300)
    );
  }

  /**
   * Get binding residues with prediction data
   */
  getBindingResidues(
    proteinId: string, 
    method: PredictionMethod
  ): Observable<BindingResidue[]> {
    // Mock binding residues for demonstration
    const mockBindingResidues: BindingResidue[] = [
      // True Positives
      { position: 45, chainId: 'A', aminoAcid: 'ASP', residueNumber: 45, 
        groundTruth: true, predicted: true, confidence: 0.92, status: 'TP' },
      { position: 78, chainId: 'A', aminoAcid: 'HIS', residueNumber: 78, 
        groundTruth: true, predicted: true, confidence: 0.88, status: 'TP' },
      { position: 112, chainId: 'A', aminoAcid: 'GLU', residueNumber: 112, 
        groundTruth: true, predicted: true, confidence: 0.95, status: 'TP' },
      
      // True Negatives
      { position: 10, chainId: 'A', aminoAcid: 'ALA', residueNumber: 10, 
        groundTruth: false, predicted: false, confidence: 0.15, status: 'TN' },
      { position: 25, chainId: 'A', aminoAcid: 'GLY', residueNumber: 25, 
        groundTruth: false, predicted: false, confidence: 0.22, status: 'TN' },
      { position: 67, chainId: 'A', aminoAcid: 'PRO', residueNumber: 67, 
        groundTruth: false, predicted: false, confidence: 0.18, status: 'TN' },
      { position: 95, chainId: 'A', aminoAcid: 'SER', residueNumber: 95, 
        groundTruth: false, predicted: false, confidence: 0.28, status: 'TN' },
      
      // False Positives
      { position: 55, chainId: 'A', aminoAcid: 'LEU', residueNumber: 55, 
        groundTruth: false, predicted: true, confidence: 0.72, status: 'FP' },
      { position: 89, chainId: 'A', aminoAcid: 'VAL', residueNumber: 89, 
        groundTruth: false, predicted: true, confidence: 0.68, status: 'FP' },
      
      // False Negatives
      { position: 145, chainId: 'A', aminoAcid: 'ASP', residueNumber: 145, 
        groundTruth: true, predicted: false, confidence: 0.45, status: 'FN' },
      { position: 148, chainId: 'A', aminoAcid: 'HIS', residueNumber: 148, 
        groundTruth: true, predicted: false, confidence: 0.52, status: 'FN' }
    ];

    return of(mockBindingResidues).pipe(delay(200));
  }

  /**
   * Load PDB file from assets
   */
  private loadPDBFile(filename: string): Observable<string> {
    // In production, this would use HttpClient to fetch from assets
    // For now, return a small example PDB structure
    return of(this.getExamplePDB());
  }

  /**
   * Extract PDB ID from PDB data
   */
  private extractPDBId(pdbData: string): string {
    const headerMatch = pdbData.match(/HEADER.+?(\d[A-Z0-9]{3})/);
    return headerMatch ? headerMatch[1] : 'MOCK';
  }

  /**
   * Extract chains from PDB data
   */
  private extractChains(pdbData: string): any[] {
    const chains = new Set<string>();
    const lines = pdbData.split('\n');
    
    lines.forEach(line => {
      if (line.startsWith('ATOM')) {
        const chainId = line.substring(21, 22).trim();
        if (chainId) chains.add(chainId);
      }
    });

    return Array.from(chains).map(id => ({
      id,
      length: 0 // Would be calculated from residue count
    }));
  }

  /**
   * Extract residues from PDB data
   */
  private extractResidues(pdbData: string): any[] {
    const residues: any[] = [];
    const lines = pdbData.split('\n');
    const seenResidues = new Set<string>();

    lines.forEach(line => {
      if (line.startsWith('ATOM')) {
        const chainId = line.substring(21, 22).trim();
        const residueNumber = parseInt(line.substring(22, 26).trim());
        const aminoAcid = line.substring(17, 20).trim();
        const key = `${chainId}-${residueNumber}`;

        if (!seenResidues.has(key)) {
          seenResidues.add(key);
          residues.push({
            position: residueNumber,
            chainId,
            aminoAcid,
            residueNumber
          });
        }
      }
    });

    return residues;
  }

  /**
   * Extract ligands from PDB data
   */
  private extractLigands(pdbData: string): any[] {
    const ligands: any[] = [];
    const lines = pdbData.split('\n');
    const seenLigands = new Set<string>();

    lines.forEach(line => {
      if (line.startsWith('HETATM')) {
        const name = line.substring(17, 20).trim();
        const chainId = line.substring(21, 22).trim();
        const residueNumber = parseInt(line.substring(22, 26).trim());
        const key = `${name}-${chainId}-${residueNumber}`;

        if (!seenLigands.has(key) && name !== 'HOH') {
          seenLigands.add(key);
          ligands.push({
            id: key,
            name,
            chainId,
            residueNumber
          });
        }
      }
    });

    return ligands;
  }

  /**
   * Extract metal ions from PDB data
   */
  private extractMetalIons(pdbData: string): any[] {
    const metals = ['ZN', 'MG', 'CA', 'FE', 'MN', 'CU', 'NA', 'K'];
    const metalIons: any[] = [];
    const lines = pdbData.split('\n');

    lines.forEach(line => {
      if (line.startsWith('HETATM')) {
        const element = line.substring(17, 20).trim();
        if (metals.includes(element)) {
          const chainId = line.substring(21, 22).trim();
          const residueNumber = parseInt(line.substring(22, 26).trim());
          
          metalIons.push({
            element,
            chainId,
            residueNumber
          });
        }
      }
    });

    return metalIons;
  }

  /**
   * Get a small example PDB structure for demonstration
   * This is a real small protein structure with proper formatting
   */
  private getExamplePDB(): string {
    return `HEADER    BINDING SITE PREDICTION                 01-SEP-26   DEMO              
TITLE     EXAMPLE PROTEIN STRUCTURE FOR VISUALIZATION                         
COMPND    MOL_ID: 1;                                                          
COMPND   2 MOLECULE: DEMO PROTEIN;                                            
COMPND   3 CHAIN: A;                                                          
SOURCE    MOL_ID: 1;                                                          
SOURCE   2 SYNTHETIC: YES;                                                    
KEYWDS    BINDING SITE, PREDICTION                                            
ATOM      1  N   MET A   1       8.932  -2.167  -0.736  1.00 10.00           N  
ATOM      2  CA  MET A   1       9.135  -0.732  -0.530  1.00 10.00           C  
ATOM      3  C   MET A   1       8.050   0.094  -1.218  1.00 10.00           C  
ATOM      4  O   MET A   1       7.490  -0.312  -2.235  1.00 10.00           O  
ATOM      5  CB  MET A   1      10.512  -0.309  -1.038  1.00 10.00           C  
ATOM      6  N   ALA A   2       7.758   1.274  -0.664  1.00 10.00           N  
ATOM      7  CA  ALA A   2       6.766   2.178  -1.233  1.00 10.00           C  
ATOM      8  C   ALA A   2       7.325   3.595  -1.283  1.00 10.00           C  
ATOM      9  O   ALA A   2       8.269   3.896  -0.545  1.00 10.00           O  
ATOM     10  CB  ALA A   2       5.458   2.176  -0.442  1.00 10.00           C  
ATOM     11  N   GLY A   3       6.743   4.465  -2.100  1.00 10.00           N  
ATOM     12  CA  GLY A   3       7.158   5.854  -2.214  1.00 10.00           C  
ATOM     13  C   GLY A   3       6.074   6.781  -2.759  1.00 10.00           C  
ATOM     14  O   GLY A   3       4.929   6.366  -2.938  1.00 10.00           O  
ATOM     15  N   SER A   4       6.436   8.031  -3.031  1.00 10.00           N  
ATOM     16  CA  SER A   4       5.503   9.046  -3.525  1.00 10.00           C  
ATOM     17  C   SER A   4       5.768  10.397  -2.864  1.00 10.00           C  
ATOM     18  O   SER A   4       6.908  10.761  -2.580  1.00 10.00           O  
ATOM     19  CB  SER A   4       5.618   9.200  -5.045  1.00 10.00           C  
ATOM     20  OG  SER A   4       4.834   10.278  -5.531  1.00 10.00           O  
ATOM     21  N   ASP A  45       4.700  11.152  -2.620  1.00 10.00           N  
ATOM     22  CA  ASP A  45       4.814  12.463  -1.990  1.00 10.00           C  
ATOM     23  C   ASP A  45       3.906  13.479  -2.680  1.00 10.00           C  
ATOM     24  O   ASP A  45       2.693  13.272  -2.778  1.00 10.00           O  
ATOM     25  CB  ASP A  45       4.477  12.386  -0.498  1.00 10.00           C  
ATOM     26  CG  ASP A  45       5.367  11.451   0.296  1.00 10.00           C  
ATOM     27  OD1 ASP A  45       6.581  11.397   0.030  1.00 10.00           O  
ATOM     28  OD2 ASP A  45       4.861  10.759   1.202  1.00 10.00           O  
ATOM     29  N   LEU A  55       4.492  14.580  -3.139  1.00 10.00           N  
ATOM     30  CA  LEU A  55       3.730  15.657  -3.766  1.00 10.00           C  
ATOM     31  C   LEU A  55       3.920  16.973  -3.023  1.00 10.00           C  
ATOM     32  O   LEU A  55       5.028  17.330  -2.625  1.00 10.00           O  
ATOM     33  CB  LEU A  55       4.159  15.842  -5.225  1.00 10.00           C  
ATOM     34  CG  LEU A  55       3.903  14.695  -6.209  1.00 10.00           C  
ATOM     35  CD1 LEU A  55       4.485  15.027  -7.577  1.00 10.00           C  
ATOM     36  CD2 LEU A  55       2.415  14.406  -6.351  1.00 10.00           C  
ATOM     37  N   HIS A  78       2.851  17.719  -2.839  1.00 10.00           N  
ATOM     38  CA  HIS A  78       2.896  19.009  -2.142  1.00 10.00           C  
ATOM     39  C   HIS A  78       2.089  20.075  -2.881  1.00 10.00           C  
ATOM     40  O   HIS A  78       0.866  19.977  -2.993  1.00 10.00           O  
ATOM     41  CB  HIS A  78       2.337  18.866  -0.721  1.00 10.00           C  
ATOM     42  CG  HIS A  78       3.053  17.872   0.145  1.00 10.00           C  
ATOM     43  ND1 HIS A  78       4.312  18.084   0.663  1.00 10.00           N  
ATOM     44  CD2 HIS A  78       2.651  16.638   0.547  1.00 10.00           C  
ATOM     45  CE1 HIS A  78       4.664  17.028   1.380  1.00 10.00           C  
ATOM     46  NE2 HIS A  78       3.676  16.135   1.311  1.00 10.00           N  
ATOM     47  N   VAL A  89       2.781  21.093  -3.380  1.00 10.00           N  
ATOM     48  CA  VAL A  89       2.145  22.215  -4.064  1.00 10.00           C  
ATOM     49  C   VAL A  89       2.356  23.502  -3.266  1.00 10.00           C  
ATOM     50  O   VAL A  89       3.480  23.850  -2.901  1.00 10.00           O  
ATOM     51  CB  VAL A  89       2.672  22.386  -5.502  1.00 10.00           C  
ATOM     52  CG1 VAL A  89       1.994  23.569  -6.187  1.00 10.00           C  
ATOM     53  CG2 VAL A  89       2.447  21.118  -6.318  1.00 10.00           C  
ATOM     54  N   GLU A 112       1.282  24.221  -2.996  1.00 10.00           N  
ATOM     55  CA  GLU A 112       1.333  25.477  -2.245  1.00 10.00           C  
ATOM     56  C   GLU A 112       0.529  26.574  -2.950  1.00 10.00           C  
ATOM     57  O   GLU A 112      -0.696  26.494  -3.053  1.00 10.00           O  
ATOM     58  CB  GLU A 112       0.776  25.274  -0.829  1.00 10.00           C  
ATOM     59  CG  GLU A 112       1.543  24.249  -0.003  1.00 10.00           C  
ATOM     60  CD  GLU A 112       0.988  24.038   1.395  1.00 10.00           C  
ATOM     61  OE1 GLU A 112      -0.232  24.240   1.592  1.00 10.00           O  
ATOM     62  OE2 GLU A 112       1.758  23.679   2.304  1.00 10.00           O  
ATOM     63  N   ASP A 145       1.243  27.611  -3.398  1.00 10.00           N  
ATOM     64  CA  ASP A 145       0.611  28.748  -4.063  1.00 10.00           C  
ATOM     65  C   ASP A 145       0.850  30.045  -3.291  1.00 10.00           C  
ATOM     66  O   ASP A 145       2.000  30.400  -2.996  1.00 10.00           O  
ATOM     67  CB  ASP A 145       1.130  28.909  -5.495  1.00 10.00           C  
ATOM     68  CG  ASP A 145       0.782  27.746  -6.405  1.00 10.00           C  
ATOM     69  OD1 ASP A 145       0.003  26.866  -5.984  1.00 10.00           O  
ATOM     70  OD2 ASP A 145       1.279  27.708  -7.550  1.00 10.00           O  
ATOM     71  N   HIS A 148      -0.201  30.761  -2.961  1.00 10.00           N  
ATOM     72  CA  HIS A 148      -0.113  32.024  -2.225  1.00 10.00           C  
ATOM     73  C   HIS A 148      -0.917  33.130  -2.910  1.00 10.00           C  
ATOM     74  O   HIS A 148      -2.143  33.045  -3.012  1.00 10.00           O  
ATOM     75  CB  HIS A 148      -0.622  31.835  -0.791  1.00 10.00           C  
ATOM     76  CG  HIS A 148       0.112  30.796  -0.003  1.00 10.00           C  
ATOM     77  ND1 HIS A 148       1.376  31.010   0.499  1.00 10.00           N  
ATOM     78  CD2 HIS A 148      -0.248  29.532   0.348  1.00 10.00           C  
ATOM     79  CE1 HIS A 148       1.747  29.928   1.154  1.00 10.00           C  
ATOM     80  NE2 HIS A 148       0.784  29.003   1.057  1.00 10.00           N  
TER      81      HIS A 148                                                      
END                                                                             
`;
  }
}

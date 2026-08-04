<?php

class Sirius_Smf_Report_Edi_Carelon extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-carelon';

  public function benefit_nid() { return $this->benefit_nid_from_id('CARELONEAP'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Carelon'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_carelon.inc',
      'row_encoding' => 'json',
      'edi_tiers' => array('mlk', 'other'),
      'edi_output_format' => 'csv',
      'edi_csv_hide_header' => TRUE,
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }

    if ($this->medical_coverage_id($context) == 'M') { return 'mlk'; }
    return 'other';
  }

  public function edi_fields() {
    $fields = array();
    $fields['MEMBNO'] = array('width' => 15);
    $fields['SOCSEC'] = array('width' => 9);
    $fields['LSTNAM'] = array('width' => 25);
    $fields['FSTNAM'] = array('width' => 20);
    $fields['MIDNAM'] = array('width' => 1);
    $fields['ADRLN1'] = array('width' => 40);
    $fields['ADRLN2'] = array('width' => 40);
    $fields['CITYCD'] = array('width' => 25);
    $fields['STACOD'] = array('width' => 2);
    $fields['ZIPCOD'] = array('width' => 10);
    $fields['HOMPHN'] = array('width' => 12);
    $fields['WRKPHN'] = array('width' => 12);
    $fields['BTHDAT'] = array('width' => 8);
    $fields['RELCOD'] = array('width' => 2);
    $fields['SEXCOD'] = array('width' => 1);
    $fields['GRPEFF'] = array('width' => 8);
    $fields['GRPEXP'] = array('width' => 8);
    $fields['GRPNUM'] = array('width' => 25);
    $fields['BENPKG'] = array('width' => 25);
    $fields['TIERCD'] = array('width' => 4);
    $fields['MSTACD'] = array('width' => 1);
    $fields['ALTNUM'] = array('width' => 15);
    $fields['CLIDEF'] = array('width' => 295);
    return $fields;
  }

  public function batch($workers, $values, &$batch_context) {
    $benefit_nid = $this->benefit_nid();

    $asof_date = date('Y-m-d 00:00:00', strtotime($values['parameters']['asof_date']));

    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }

      $row = array();

      $row['MEMBNO'] = $this->ssn($context, 'subscriber_node'); 
      $row['SOCSEC'] = $this->ssn($context, 'worker_node'); 
      $row['LSTNAM'] = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['FSTNAM'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['MIDNAM'] = substr($context['worker_node']->field_sirius_name['und'][0]['middle'], 0, 1);

      $row['ADRLN1'] = preg_replace('/\'\"/', '', $context['worker_node']->field_sirius_address['und'][0]['thoroughfare']);
      $row['ADRLN2'] = preg_replace('/\'\"/', '', $context['worker_node']->field_sirius_address['und'][0]['premise']);
      $row['CITYCD'] = preg_replace('/\'\"/', '', $context['worker_node']->field_sirius_address['und'][0]['locality']);
      $row['STACOD'] = $context['worker_node']->field_sirius_address['und'][0]['administrative_area'];
      $row['ZIPCOD'] = $this->zip($context, 'worker_node');

      if (!$row['ADRLN1']) {
        $row['ADRLN1'] = preg_replace('/\'\"/', '', $context['subscriber_node']->field_sirius_address['und'][0]['thoroughfare']);
        $row['ADRLN2'] = preg_replace('/\'\"/', '', $context['subscriber_node']->field_sirius_address['und'][0]['premise']);
        $row['CITYCD'] = preg_replace('/\'\"/', '', $context['subscriber_node']->field_sirius_address['und'][0]['locality']);
        $row['STACOD'] = $context['subscriber_node']->field_sirius_address['und'][0]['administrative_area'];
        $row['ZIPCOD'] = $this->zip($context, 'subscriber_node');
      }

      $row['HOMPHN'] = $this->phone($context, 'worker_node');
      $row['WRKPHN'] = '';
      $row['BTHDAT'] = $this->dob($context, 'worker_node');
      $row['RELCOD'] = $this->relcod($context);
      $row['SEXCOD'] = $this->gender($context);
      $row['GRPEFF'] = $this->coverage_start_date($context);
      $row['GRPEXP'] = $this->coverage_end_date($context);
      $row['GRPNUM'] = $this->grpnum($context);
      $row['BENPKG'] = $row['GRPNUM'];
      $row['TIERCD'] = $this->tiercd($context);
      $row['MSTACD'] = $this->mstacd($context);
      $row['ALTNUM'] = '';
      $row['CLIDEF'] = '';

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  public function relcod($context) {
    $reltype_id = $this->relationship_type($context['relationship_node']); 

    if (in_array($reltype_id, array('SP', 'DP'))) { return '02'; }
    if (in_array($reltype_id, array('C', 'AC', 'H', 'QMSCO', 'SC', 'G'))) { return '03'; }
    return '01';
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'M') { return 'M'; }
    if ($id == 'F') { return 'F'; }
    return 'U';
  }

  public function grpnum($context) {
    return $this->medical_coverage_id($context);
  }

  public function mstacd($context) {
    if ($this->is_cobra($context)) { return 'C'; }
    return 'A'; 
  }

  public function tiercd($context) {
    if ($this->is_dependent($context)) { return ''; }

    $has_spouse = $has_child = FALSE;
    foreach ($context['dependent_relationship_nodes'] as $relationship_nid => $relationship_node) {
      $reltype_id = $this->relationship_type($relationship_node);

      if (in_array($reltype_id, array('DP', 'ES', 'SP'))) { $has_spouse = TRUE; }
      if (in_array($reltype_id, array('C', 'AC', 'H', 'QMSCO', 'SC'))) { $has_child = TRUE; }
    }

    if ($has_spouse && $has_child) {
      $indicator = 'FMLY';
    } else if ($has_spouse) {
      $indicator = 'SEMP';
    } else if ($has_child) {
      $indicator = 'AEMP';
    } else {
      $indicator = 'EEMP';
    }

    return $indicator;
  }
}